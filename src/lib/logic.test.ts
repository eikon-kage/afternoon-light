import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../types'
import { addMonths, fmt, monthGrid, toMin, weekDays } from './time'
import { capsuleInfo, repeatLabel, rowStates, streak } from './status'
import { periodStats } from './stats'
import { DEFAULT_RULES, dueReminders, missingOccurrences, occursOn, prevMonthDatesISO, recap, weekDatesISO } from '../../supabase/functions/_shared/rules'

const task = (p: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2), group_id: null, title: 'T', date: '2026-10-22', start_time: null, duration_min: null,
  reminder: '10', repeat: 'never', notes: '', urgent: false, done: false, done_at: null, series_id: null, repeat_days: null, skipped: false, ...p,
})

describe('time', () => {
  it('weeks start on Monday', () => {
    expect(weekDays('2026-10-22')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  })
  it('month grid is whole weeks and covers the month', () => {
    const g = monthGrid('2026-10-15')
    expect(g.length % 7).toBe(0)
    expect(g[0]).toBe('2026-09-28')
    expect(g).toContain('2026-10-31')
  })
  it('adds months from the first of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('formats minutes', () => {
    expect(fmt(toMin('09:05') + 70)).toBe('10:15')
  })
})

describe('row states', () => {
  const today = '2026-10-22'
  it('marks running, next, overdue and missed', () => {
    const run = task({ start_time: '14:30', duration_min: 90 })
    const next = task({ start_time: '19:00', duration_min: 60 })
    const later = task({ start_time: '21:00', duration_min: 30 })
    const late = task({ start_time: '09:00', duration_min: 10 })
    const s = rowStates([run, next, later, late], today, today, toMin('14:40'))
    expect(s.get(run.id)!.st).toBe('run')
    expect(s.get(run.id)!.left).toBe(80)
    expect(s.get(next.id)!.st).toBe('next')
    expect(s.get(later.id)!.st).toBe('')
    expect(s.get(late.id)!.lateText).toBe('Overdue · since 09:10')
    const missed = task({ date: '2026-10-21' })
    expect(rowStates([missed], '2026-10-21', today, 0).get(missed.id)!.st).toBe('missed')
  })
  it('capsule prefers the running task', () => {
    const run = task({ title: 'Guide', start_time: '14:30', duration_min: 90 })
    expect(capsuleInfo([run, task({ start_time: '19:00' })], toMin('14:40'))?.text).toBe('Guide · until 16:00')
  })
})

describe('period stats', () => {
  it('counts days up to today only and finds the best day', () => {
    const tasks = [
      task({ date: '2026-10-19', done: true }), task({ date: '2026-10-19' }),
      task({ date: '2026-10-21', done: true }), task({ date: '2026-10-21', done: true }),
      task({ date: '2026-10-23' }), task({ date: '2026-10-23' }),
    ]
    const s = periodStats(tasks, weekDays('2026-10-22'), '2026-10-22')
    expect(s.planned).toBe(4)
    expect(s.done).toBe(3)
    expect(s.rate).toBe(75)
    expect(s.best?.date).toBe('2026-10-21')
    expect(s.days.find((d) => d.date === '2026-10-23')).toMatchObject({ p: 2, future: true })
  })
  it('on-time means done before end + 30 min', () => {
    const d = (h: number, m: number) => new Date(2026, 9, 22, h, m).toISOString()
    const tasks = [
      task({ start_time: '10:00', duration_min: 30, done: true, done_at: d(10, 59) }),
      task({ start_time: '10:00', duration_min: 30, done: true, done_at: d(11, 1) }),
    ]
    expect(periodStats(tasks, ['2026-10-22'], '2026-10-22').ontime).toBe(50)
  })
})

describe('reminder rules', () => {
  const base = { s: DEFAULT_RULES, today: '2026-10-22', weekday: 4, dom: 22, recapWeek: () => recap([], [], ''), recapPrevMonth: () => recap([], [], '') }
  const t = task({ id: 'a', start_time: '10:00', duration_min: 45, reminder: '10' })
  const keys = (m: number, tasks = [t], s = DEFAULT_RULES) => dueReminders({ ...base, s, tasks, m }).map((d) => d.key)

  it('fires before, at start and one nudge after the end', () => {
    expect(keys(toMin('09:49'))).toEqual([])
    expect(keys(toMin('09:50'))).toEqual(['2026-10-22:a:pre'])
    expect(keys(toMin('10:02'))).toEqual(['2026-10-22:a:start'])
    expect(keys(toMin('11:15'))).toEqual(['2026-10-22:a:nudge'])
  })
  it('skips done tasks and respects "none"', () => {
    expect(keys(toMin('10:00'), [{ ...t, done: true }])).toEqual([])
    expect(keys(toMin('10:00'), [{ ...t, reminder: 'none' }])).toEqual([])
  })
  it('keeps quiet hours unless urgent tasks may break through', () => {
    const night = { ...t, start_time: '22:30', duration_min: 30 }
    expect(keys(toMin('22:30'), [night])).toEqual([])
    expect(keys(toMin('22:30'), [{ ...night, urgent: true }], { ...DEFAULT_RULES, urgent_through: true })).toEqual(['2026-10-22:a:start'])
  })
  it('sends the morning summary for untimed tasks', () => {
    const r = dueReminders({ ...base, tasks: [task({ title: 'Buy rice' })], m: toMin('08:05') })
    expect(r).toHaveLength(1)
    expect(r[0].body).toContain('Buy rice')
  })
  it('weekly recap only on Sunday evening', () => {
    const tasks = [task({ date: '2026-10-19', done: true }), task({ date: '2026-10-19', done: true })]
    const recapWeek = () => recap(tasks, weekDatesISO('2026-10-25'), '2026-10-25')
    expect(dueReminders({ ...base, today: '2026-10-25', weekday: 0, tasks, m: toMin('19:10'), recapWeek }).map((d) => d.title)).toEqual(['This week'])
    expect(dueReminders({ ...base, tasks, m: toMin('19:10'), recapWeek })).toEqual([])
  })
  it('date helpers', () => {
    expect(weekDatesISO('2026-10-25')[0]).toBe('2026-10-19')
    const pm = prevMonthDatesISO('2026-03-01')
    expect([pm[0], pm[pm.length - 1]]).toEqual(['2026-02-01', '2026-02-28'])
  })
})

describe('repeating tasks', () => {
  const rule = (repeat: string, repeat_days: number | null = null) => ({ repeat, repeat_days })
  it('knows which days a rule falls on', () => {
    expect(occursOn(rule('daily'), '2026-10-22', '2026-10-25')).toBe(true)
    expect(occursOn(rule('weekdays'), '2026-10-22', '2026-10-24')).toBe(false) // Saturday
    expect(occursOn(rule('weekly'), '2026-10-22', '2026-10-29')).toBe(true) // next Thursday
    expect(occursOn(rule('weekly'), '2026-10-22', '2026-10-28')).toBe(false)
    const monWedFri = 1 | 4 | 16
    expect(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23'].map((d) => occursOn(rule('custom', monWedFri), '2026-10-19', d))).toEqual([true, false, true, true])
  })
  it('fills only the missing days, from the series start, using the newest day as template', () => {
    const a = task({ id: 'a', series_id: 's', repeat: 'daily', date: '2026-10-20', title: 'Old name' })
    const b = task({ id: 'b', series_id: 's', repeat: 'daily', date: '2026-10-22', title: 'Meditate' })
    const miss = missingOccurrences([a, b], weekDays('2026-10-22'))
    expect(miss.map((m) => m.date)).toEqual(['2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(miss[0].template.title).toBe('Meditate')
  })
  it('a skipped day stays skipped and a stopped series makes nothing', () => {
    const skipped = task({ series_id: 's', repeat: 'daily', date: '2026-10-23', skipped: true })
    const today = task({ series_id: 's', repeat: 'daily', date: '2026-10-22' })
    expect(missingOccurrences([today, skipped], ['2026-10-23']).length).toBe(0)
    expect(missingOccurrences([task({ series_id: 't', repeat: 'never' })], ['2026-10-23']).length).toBe(0)
  })
  it('counts the streak back from today', () => {
    const day = (date: string, done: boolean, skipped = false) => task({ series_id: 's', repeat: 'daily', date, done, skipped })
    const all = [day('2026-10-18', false), day('2026-10-19', true), day('2026-10-20', true, true), day('2026-10-21', true), day('2026-10-22', false)]
    expect(streak(all, all[4], '2026-10-22')).toBe(2) // 19 and 21 done, 20 skipped, today still open
    all[4].done = true
    expect(streak(all, all[4], '2026-10-22')).toBe(3)
  })
  it('labels the rule', () => {
    expect(repeatLabel({ repeat: 'custom', repeat_days: 1 | 4 | 16, date: '2026-10-22' })).toBe('Mon, Wed, Fri')
    expect(repeatLabel({ repeat: 'weekly', repeat_days: null, date: '2026-10-22' })).toBe('Every Thu')
  })
})

vi.mock('./supabase', () => {
  const calls: unknown[] = []
  const ok = Promise.resolve({ error: null })
  const builder = (table: string) => ({
    insert: (p: unknown) => { calls.push(['insert', table, p]); return ok },
    update: (p: unknown) => ({ eq: (_c: string, id: string) => { calls.push(['update', table, id, p]); return ok } }),
    delete: () => ({ eq: (_c: string, id: string) => { calls.push(['delete', table, id]); return ok } }),
  })
  return { supabase: { from: builder, calls }, configured: true }
})

describe('outbox', async () => {
  const { Outbox, applyPending } = await import('./outbox')
  const { supabase } = (await import('./supabase')) as unknown as { supabase: { calls: unknown[] } }

  it('merges updates into a queued insert and drops insert+delete', () => {
    const ob = new Outbox('u1', () => {}, () => {})
    // fill the queue without sending: pretend a send is in flight
    ;(ob as unknown as { running: boolean }).running = true
    ob.push({ table: 'tasks', kind: 'update', id: 'x', payload: { title: 'busy' } }) // becomes ops[0], "in flight"
    ob.push({ table: 'tasks', kind: 'insert', id: 'a', payload: { id: 'a', title: 'A' } })
    ob.push({ table: 'tasks', kind: 'update', id: 'a', payload: { done: true } })
    ob.push({ table: 'tasks', kind: 'insert', id: 'b', payload: { id: 'b' } })
    ob.push({ table: 'tasks', kind: 'delete', id: 'b' })
    expect(ob.pending).toEqual([
      { table: 'tasks', kind: 'update', id: 'x', payload: { title: 'busy' } },
      { table: 'tasks', kind: 'insert', id: 'a', payload: { id: 'a', title: 'A', done: true } },
    ])
  })
  it('sends queued ops in order', async () => {
    supabase.calls.length = 0
    const ob = new Outbox('u2', () => {}, () => {})
    ob.push({ table: 'groups', kind: 'insert', id: 'g', payload: { id: 'g' } })
    ob.push({ table: 'groups', kind: 'update', id: 'g', payload: { name: 'N' } })
    await ob.flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(ob.pending).toEqual([])
    expect(supabase.calls.map((c) => (c as string[])[0])).toEqual(['insert', 'update'])
  })
  it('re-applies pending ops over server rows', () => {
    const rows = [{ id: 'a', title: 'old' }, { id: 'b', title: 'gone' }]
    const out = applyPending(rows, [
      { table: 'tasks', kind: 'update', id: 'a', payload: { title: 'new' } },
      { table: 'tasks', kind: 'delete', id: 'b' },
      { table: 'tasks', kind: 'insert', id: 'c', payload: { id: 'c', title: 'c' } },
    ], 'tasks')
    expect(out).toEqual([{ id: 'a', title: 'new' }, { id: 'c', title: 'c' }])
  })
})
