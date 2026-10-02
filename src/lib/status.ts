import type { Task } from '../types'
import { addDays, fmt, leftTxt, toMin, wdIndex } from './time'
import { occursOn } from '../../supabase/functions/_shared/rules'

export type St = '' | 'run' | 'next' | 'late' | 'missed'
export interface RowState {
  st: St
  progress: number
  left: number
  lateText: string
}

const end = (t: Task) => toMin(t.start_time!) + (t.duration_min ?? 0)

/** Running / next / overdue state of each task on `date`, seen at `now` minutes on `today`. */
export function rowStates(list: Task[], date: string, today: string, now: number) {
  const m = new Map<string, RowState>()
  let next: Task | null = null
  for (const t of list) {
    const s: RowState = { st: '', progress: 0, left: 0, lateText: '' }
    if (!t.done) {
      if (date < today) {
        s.st = 'missed'
        s.lateText = 'Not done'
      } else if (date === today && t.start_time) {
        const st = toMin(t.start_time)
        const en = end(t)
        if (t.duration_min && st <= now && now < en) {
          s.st = 'run'
          s.progress = (now - st) / (en - st)
          s.left = en - now
        } else if (en < now) {
          s.st = 'late'
          s.lateText = now - en > 60 ? `Overdue · since ${fmt(en)}` : `Overdue · ${now - en} min`
        } else if (st > now && (!next || st < toMin(next.start_time!))) next = t
      }
    }
    m.set(t.id, s)
  }
  if (next) m.get(next.id)!.st = 'next'
  return m
}

/** What the floating capsule shows: the running task, else the next one today. */
export function capsuleInfo(today: Task[], now: number) {
  const timed = today.filter((t) => !t.done && t.start_time)
  const run = timed.find((t) => t.duration_min && toMin(t.start_time!) <= now && now < end(t))
  if (run) return { task: run, text: `${run.title} · until ${fmt(end(run))}`, right: `${leftTxt(end(run) - now)} left` }
  const next = timed
    .filter((t) => toMin(t.start_time!) > now)
    .sort((a, b) => toMin(a.start_time!) - toMin(b.start_time!))[0]
  if (next) return { task: next, text: `${next.title} · ${next.start_time}`, right: `in ${leftTxt(toMin(next.start_time!) - now)}` }
  return null
}

/* ---------------- repeating tasks ---------------- */

const WD3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export function repeatLabel(t: Pick<Task, 'repeat' | 'repeat_days' | 'date'>) {
  switch (t.repeat) {
    case 'daily': return 'Every day'
    case 'weekdays': return 'Weekdays'
    case 'weekly': return `Every ${WD3[wdIndex(t.date)]}`
    case 'custom': return WD3.filter((_, i) => (t.repeat_days ?? 0) & (1 << i)).join(', ')
    default: return ''
  }
}

/**
 * Days in a row this repeating task was done, counting back from today
 * (today counts once it is done; an unfinished today does not break the streak). Skipped days are passed over.
 */
export function streak(all: Task[], t: Task, today: string) {
  if (!t.series_id) return 0
  const byDate = new Map(all.filter((x) => x.series_id === t.series_id).map((x) => [x.date, x]))
  const start = [...byDate.keys()].sort()[0]
  let n = 0
  for (let d = today, i = 0; d >= start && i < 400; d = addDays(d, -1), i++) {
    if (!occursOn(t, t.date, d)) continue
    const x = byDate.get(d)
    if (x?.skipped) continue
    if (x?.done) n++
    else if (d === today) continue
    else break
  }
  return n
}
