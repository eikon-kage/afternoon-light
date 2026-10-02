import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { DEFAULT_GROUPS, type Group, type Settings, type Task } from '../types'
import { addDays, iso } from './time'
import { missingOccurrences, occursOn } from '../../supabase/functions/_shared/rules'
import { Outbox, applyPending, isNetworkError, type Op } from './outbox'

type Row = Record<string, unknown>

const normTask = (r: Row): Task => ({
  id: r.id as string,
  group_id: (r.group_id as string) ?? null,
  title: r.title as string,
  date: r.date as string,
  start_time: r.start_time ? String(r.start_time).slice(0, 5) : null,
  duration_min: (r.duration_min as number) ?? null,
  reminder: (r.reminder as Task['reminder']) ?? '10',
  repeat: (r.repeat as Task['repeat']) ?? 'never',
  notes: (r.notes as string) ?? '',
  urgent: Boolean(r.urgent),
  done: Boolean(r.done),
  done_at: (r.done_at as string) ?? null,
  series_id: (r.series_id as string) ?? null,
  repeat_days: (r.repeat_days as number) ?? null,
  skipped: Boolean(r.skipped),
})
const normGroup = (r: Row): Group => ({
  id: r.id as string,
  name: r.name as string,
  color: r.color as string,
  position: (r.position as number) ?? 0,
})
const normSettings = (r: Row): Settings => {
  const { user_id: _u, updated_at: _t, ...rest } = r
  return rest as unknown as Settings
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

/** How far ahead repeating tasks are created, so reminders and the week ahead always have them. */
const AHEAD_DAYS = 14

const DEMO_KEY = 'al:demo'
const cacheKey = (uid: string) => `al:cache:${uid}`
function readCache(uid: string): { groups: Group[]; tasks: Task[]; settings: Settings | null } | null {
  try { return JSON.parse(localStorage.getItem(cacheKey(uid)) || 'null') } catch { return null }
}
/** Removes this device's offline copy (on sign-out). Unsent changes stay queued for the next sign-in. */
export function clearCache(uid: string) {
  try { localStorage.removeItem(cacheKey(uid)) } catch { /* nothing stored */ }
}
const DEFAULT_SETTINGS: Settings = {
  before_start: true, at_start: true, nudge: true, morning: true, evening: true,
  weekly: true, monthly: true, quiet: true, urgent_through: false,
}

/** Sample week for demo mode, placed around today. */
function demoSeed() {
  const today = iso(new Date())
  const mon = addDays(today, -3) // day 3 of the sample is always today
  const g = DEFAULT_GROUPS.map((x, i) => ({ ...x, id: `g${i}`, position: i }))
  const [W, P, E] = g.map((x) => x.id)
  const t = (day: number, group: string | null, title: string, start: string | null, dur: number | null, done = false, series?: [string, Task['repeat']]): Task => ({
    id: crypto.randomUUID(), group_id: group, title, date: addDays(mon, day), start_time: start, duration_min: dur,
    reminder: '10', repeat: series?.[1] ?? 'never', notes: '', urgent: false, done, done_at: done ? new Date().toISOString() : null,
    series_id: series?.[0] ?? null, repeat_days: null, skipped: false,
  })
  const med: [string, Task['repeat']] = [crypto.randomUUID(), 'daily']
  const stand: [string, Task['repeat']] = [crypto.randomUUID(), 'weekdays']
  const past = (d: number) => addDays(mon, d) < today
  const tasks = [
    t(0, W, 'Weekly planning', '09:00', 30, past(0)), t(0, W, 'Client call with Hanh', '11:00', 45, past(0)), t(0, P, 'Gym', '18:30', 60, past(0)), t(0, E, 'Return parcel', null, null, past(0)),
    t(1, W, 'Review design mockups', '10:00', 60, past(1)), t(1, W, 'Budget sync', '14:00', 30, past(1)), t(1, P, 'Call grandma', '19:00', 20, past(1)),
    t(2, W, 'Sprint demo', '10:00', 60, past(2)), t(2, W, 'Update roadmap', '13:30', 45, past(2)), t(2, P, 'Yoga class', '07:00', 60, past(2)), t(2, P, 'Pay rent', null, null, past(2)),
    t(3, W, 'Send Q4 budget to Linh', '10:00', 45), t(3, W, 'Draft onboarding guide', '14:30', 90), t(3, P, 'Call bank about card', '09:00', 10),
    t(3, P, 'Book dentist appointment', '11:30', 15, true), t(3, P, 'Dinner with Mai', '19:00', 120), t(3, E, 'Buy rice and eggs', null, null),
    t(4, W, 'Ship release notes', '11:00', 60), t(4, W, 'Team retro', '15:00', 45), t(4, E, 'Pick up dry cleaning', null, null),
    t(5, P, 'Farmers market', '09:30', 60), t(5, P, 'Clean the flat', '14:00', 90), t(6, P, 'Call mum', '17:00', 20),
    ...[0, 1, 2, 3].map((d) => t(d, P, 'Meditate 10 minutes', '07:30', 10, past(d), med)),
    ...[0, 1, 2, 3].filter((d) => { const w = new Date(addDays(mon, d)).getDay(); return w !== 0 && w !== 6 }).map((d) => t(d, W, 'Team stand-up', '09:30', 15, past(d), stand)),
  ]
  return { groups: g, tasks }
}

/** Loads the signed-in user's data, keeps it live with Supabase Realtime, and writes changes optimistically.
 *  With `demo`, everything stays in this browser's localStorage instead. */
export function useData(userId: string, demo = false) {
  const [groups, setGroups] = useState<Group[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ready, setReady] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const loadRef = useRef<() => void>(() => {})
  const outbox = useMemo(() => demo ? null : new Outbox(userId, setPending, (msg) => {
    setError(`A change was not saved: ${msg}`)
    loadRef.current()
  }, () => loadRef.current()), [userId, demo])

  const load = useCallback(async () => {
    if (demo) {
      let saved: { groups: Group[]; tasks: Task[]; settings: Settings } | null = null
      try { saved = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null') } catch { /* start fresh */ }
      const s = saved ?? { ...demoSeed(), settings: DEFAULT_SETTINGS }
      setGroups(s.groups); setTasks(s.tasks); setSettings(s.settings); setReady(true); setLive(false)
      return
    }
    const since = addDays(iso(new Date()), -100)
    const [g, t, s] = await Promise.all([
      supabase.from('groups').select('*').order('position'),
      supabase.from('tasks').select('*').gte('date', since).order('date'),
      supabase.from('notification_settings').select('*').maybeSingle(),
    ])
    const err = g.error || t.error || s.error
    if (err) {
      if (isNetworkError(err.message)) {
        const cached = readCache(userId)
        if (cached) {
          const ops = outbox?.pending ?? []
          setGroups(applyPending(cached.groups, ops, 'groups'))
          setTasks(applyPending(cached.tasks, ops, 'tasks'))
          setSettings(cached.settings)
          setReady(true)
        } else setError('You are offline and this device has no saved copy yet. Connect once to load your tasks.')
        return
      }
      setError(`Could not load your tasks: ${err.message}. Check that supabase/schema.sql has been run.`)
      return
    }
    let gs = (g.data ?? []).map(normGroup)
    if (!gs.length) {
      const { data } = await supabase
        .from('groups')
        .insert(DEFAULT_GROUPS.map((x, i) => ({ ...x, position: i })))
        .select()
      gs = (data ?? []).map(normGroup)
    }
    let st = s.data ? normSettings(s.data) : null
    if (!st) {
      const { data } = await supabase.from('notification_settings').upsert({ user_id: userId }).select().single()
      st = data ? normSettings(data) : null
    }
    const ops = outbox?.pending ?? []
    setGroups(applyPending(gs, ops, 'groups').sort((a, b) => a.position - b.position))
    setTasks(applyPending((t.data ?? []).map(normTask), ops, 'tasks'))
    const so = ops.filter((o) => o.table === 'notification_settings').reduce((a, o) => ({ ...a, ...o.payload }), {})
    setSettings(st ? { ...st, ...so } : st)
    setReady(true)
  }, [userId, demo, outbox])
  loadRef.current = load

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      try { localStorage.setItem(demo ? DEMO_KEY : cacheKey(userId), JSON.stringify({ groups, tasks, settings })) } catch { /* offline copy is best-effort */ }
    }, 400)
    return () => clearTimeout(t)
  }, [demo, userId, ready, groups, tasks, settings])

  useEffect(() => {
    load()
    if (demo) return
    const own = `user_id=eq.${userId}`
    const ch = supabase
      .channel(`sync-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: own }, (p) =>
        setTasks((l) => upsert(l, normTask(p.new))))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: own }, (p) =>
        setTasks((l) => upsert(l, normTask(p.new))))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (p) =>
        setTasks((l) => l.filter((x) => x.id !== (p.old as Row).id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'groups', filter: own }, (p) =>
        setGroups((l) => upsert(l, normGroup(p.new)).sort((a, b) => a.position - b.position)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: own }, (p) =>
        setGroups((l) => upsert(l, normGroup(p.new)).sort((a, b) => a.position - b.position)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'groups' }, (p) =>
        setGroups((l) => l.filter((x) => x.id !== (p.old as Row).id)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_settings', filter: own }, (p) =>
        setSettings(normSettings(p.new)))
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') {
          outbox?.flush()
          load() // catch anything missed while disconnected
        }
      })
    const online = () => { outbox?.flush(); load() }
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('online', online)
      supabase.removeChannel(ch)
    }
  }, [userId, load, demo])

  const write = (op: Op) => outbox?.push(op)
  const visible = useMemo(() => tasks.filter((t) => !t.skipped), [tasks])

  const addTask = (t: Omit<Task, 'id'>) => {
    const id = crypto.randomUUID()
    const task: Task = { ...t, id, series_id: t.repeat !== 'never' ? t.series_id ?? id : t.series_id }
    setTasks((l) => [...l, task])
    write({ table: 'tasks', kind: 'insert', id: task.id, payload: task })
    return task
  }
  const updateTask = (id: string, patch: Partial<Task>) => {
    setTasks((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    write({ table: 'tasks', kind: 'update', id, payload: patch })
  }
  const deleteTask = (id: string) => {
    setTasks((l) => l.filter((x) => x.id !== id))
    write({ table: 'tasks', kind: 'delete', id })
  }
  const toggleDone = (t: Task) => {
    const done = !t.done
    updateTask(t.id, { done, done_at: done ? new Date().toISOString() : null })
  }

  /** Creates the missing days of every repeating task within `dates` (never before today). */
  const ensure = useCallback((dates: string[]) => {
    const today = iso(new Date())
    const future = dates.filter((d) => d >= today)
    if (!future.length) return
    const add = missingOccurrences(tasksRef.current, future)
    if (!add.length) return
    const made = add.map(({ template, date }): Task => ({
      ...template, id: crypto.randomUUID(), date, done: false, done_at: null, skipped: false,
    }))
    tasksRef.current = [...tasksRef.current, ...made]
    setTasks((l) => [...l, ...made])
    for (const m of made) write({ table: 'tasks', kind: 'insert', id: m.id, payload: m })
  }, [outbox]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return
    const today = iso(new Date())
    ensure(Array.from({ length: AHEAD_DAYS }, (_, i) => addDays(today, i)))
  }, [ready, ensure, tasks.length])

  /**
   * Saves an edit. For a repeating task it also applies to the upcoming, unfinished days of the series;
   * days that no longer fit a changed rule are removed (the generator refills the right ones).
   */
  const saveTask = (t: Task, values: Partial<Task>) => {
    const rule = { repeat: values.repeat ?? t.repeat, repeat_days: values.repeat_days ?? t.repeat_days }
    const seriesId = t.series_id ?? (rule.repeat !== 'never' ? t.id : null)
    updateTask(t.id, { ...values, series_id: seriesId })
    if (!t.series_id) return
    const { date: _d, ...shared } = values
    for (const x of tasksRef.current) {
      if (x.series_id !== t.series_id || x.id === t.id || x.date <= t.date || x.done) continue
      if (rule.repeat === 'never' || !occursOn(rule, values.date ?? t.date, x.date)) deleteTask(x.id)
      else updateTask(x.id, shared)
    }
  }
  /** Removes one day of a repeating task without the generator bringing it back. */
  const skipTask = (t: Task) => updateTask(t.id, { skipped: true })
  /** Stops a repeating task from this day on: this and later unfinished days go; earlier days stay as history. */
  const stopSeries = (t: Task) => {
    for (const x of tasksRef.current) {
      if (x.series_id !== t.series_id) continue
      if (x.date >= t.date && !x.done) deleteTask(x.id)
      else if (x.repeat !== 'never') updateTask(x.id, { repeat: 'never' })
    }
  }
  const moveToTomorrow = (t: Task) => updateTask(t.id, { date: addDays(t.date, 1), done: false, done_at: null })

  const addGroup = (name: string, color: string) => {
    const g = { id: crypto.randomUUID(), name, color, position: groups.length ? Math.max(...groups.map((x) => x.position)) + 1 : 0 }
    setGroups((l) => [...l, g])
    write({ table: 'groups', kind: 'insert', id: g.id, payload: g })
    return g
  }
  const updateGroup = (id: string, patch: Partial<Group>) => {
    setGroups((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    write({ table: 'groups', kind: 'update', id, payload: patch })
  }
  const deleteGroup = (id: string) => {
    setGroups((l) => l.filter((x) => x.id !== id))
    setTasks((l) => l.map((x) => (x.group_id === id ? { ...x, group_id: null } : x)))
    write({ table: 'groups', kind: 'delete', id })
  }
  const moveGroup = (id: string, dir: -1 | 1) => {
    const i = groups.findIndex((g) => g.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= groups.length) return
    const a = groups[i], b = groups[j]
    setGroups((l) => {
      const n = l.slice()
      n[i] = { ...b, position: a.position }
      n[j] = { ...a, position: b.position }
      return n
    })
    write({ table: 'groups', kind: 'update', id: a.id, payload: { position: b.position } })
    write({ table: 'groups', kind: 'update', id: b.id, payload: { position: a.position } })
  }
  const saveSettings = (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    write({ table: 'notification_settings', kind: 'update', id: userId, payload: patch })
  }

  return {
    groups, tasks: visible, allTasks: tasks, settings, ready, live, pending, error, clearError: () => setError(null),
    addTask, updateTask, deleteTask, toggleDone, moveToTomorrow, ensure, saveTask, skipTask, stopSeries,
    addGroup, updateGroup, deleteGroup, moveGroup, saveSettings,
  }
}

export type Data = ReturnType<typeof useData>
