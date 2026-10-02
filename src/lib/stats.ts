import type { Task } from '../types'
import { parseISO, toMin } from './time'

export interface DayStat {
  date: string
  p: number
  d: number
  future: boolean
}
export interface PeriodStats {
  days: DayStat[]
  planned: number
  done: number
  rate: number | null
  perDay: number
  ontime: number | null
  best: DayStat | null
  groups: Map<string | null, { p: number; d: number }>
}

/** Completion over `dates`. Only days up to `today` count; future tasks are "planned", never misses. */
export function periodStats(tasks: Task[], dates: string[], today: string): PeriodStats {
  const set = new Set(dates)
  const byDay = new Map<string, Task[]>()
  for (const t of tasks) if (set.has(t.date)) (byDay.get(t.date) ?? byDay.set(t.date, []).get(t.date)!).push(t)

  let planned = 0, done = 0, onTime = 0, elapsed = 0
  let best: DayStat | null = null
  const groups = new Map<string | null, { p: number; d: number }>()
  const days = dates.map((date) => {
    const list = byDay.get(date) ?? []
    const s: DayStat = { date, p: list.length, d: list.filter((t) => t.done).length, future: date > today }
    if (!s.future) {
      elapsed++
      planned += s.p
      done += s.d
      for (const t of list) {
        const g = groups.get(t.group_id) ?? { p: 0, d: 0 }
        g.p++
        if (t.done) {
          g.d++
          if (isOnTime(t)) onTime++
        }
        groups.set(t.group_id, g)
      }
      if (s.p >= 2 && (!best || s.d / s.p > best.d / best.p || (s.d / s.p === best.d / best.p && s.d >= best.d))) best = s
    }
    return s
  })
  return {
    days,
    planned,
    done,
    rate: planned ? Math.round((done / planned) * 100) : null,
    perDay: elapsed ? done / elapsed : 0,
    ontime: done ? Math.round((onTime / done) * 100) : null,
    best,
    groups,
  }
}

/** On time = finished before the end time + 30 min (or by the end of the day for untimed tasks). */
function isOnTime(t: Task) {
  if (!t.done_at) return true
  const deadline = parseISO(t.date)
  if (t.start_time) deadline.setMinutes(toMin(t.start_time) + (t.duration_min ?? 0) + 30)
  else deadline.setHours(23, 59, 59)
  return new Date(t.done_at) <= deadline
}
