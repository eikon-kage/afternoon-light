// Reminder rules shared by the web app (while a tab is open) and the send-reminders Edge Function
// (push when the app is closed). Pure TypeScript, no runtime imports, so both Vite and Deno can load it.

export interface RTask {
  id: string
  title: string
  date: string
  start_time: string | null
  duration_min: number | null
  reminder: string
  urgent: boolean
  done: boolean
  skipped?: boolean
}
export interface RSettings {
  before_start: boolean
  at_start: boolean
  nudge: boolean
  morning: boolean
  evening: boolean
  weekly: boolean
  monthly: boolean
  quiet: boolean
  urgent_through: boolean
}
export interface Action { action: string; title: string }
export interface Due { key: string; title: string; body: string; taskId?: string; actions?: Action[] }
export interface Recap { done: number; planned: number; rate: number | null; best: string | null }

export const DEFAULT_RULES: RSettings = {
  before_start: true, at_start: true, nudge: true, morning: true, evening: true,
  weekly: true, monthly: true, quiet: true, urgent_through: false,
}

const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fmt = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
const durTxt = (d: number) => (d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`)
const list = (l: RTask[]) => l.slice(0, 3).map((t) => t.title).join(', ') + (l.length > 3 ? ` and ${l.length - 3} more` : '')

/** Calendar helpers on YYYY-MM-DD strings (no time zone involved). */
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const isoUTC = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
export const addDaysISO = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d) }
export const weekDatesISO = (s: string) => {
  const wd = (parse(s).getUTCDay() + 6) % 7
  return Array.from({ length: 7 }, (_, i) => addDaysISO(s, i - wd))
}
export const prevMonthDatesISO = (s: string) => {
  const d = parse(s)
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => isoUTC(new Date(first.getTime() + i * 86400000)))
}
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (s: string) => MONTHS[parse(s).getUTCMonth()]

/** Done / planned over `dates`, counting only days up to `today`. */
export function recap(tasks: RTask[], dates: string[], today: string): Recap {
  let done = 0, planned = 0, best: { d: string; r: number; n: number } | null = null
  for (const date of dates) {
    if (date > today) continue
    const day = tasks.filter((t) => t.date === date && !t.skipped)
    const n = day.filter((t) => t.done).length
    planned += day.length
    done += n
    if (day.length >= 2) {
      const r = n / day.length
      if (!best || r > best.r || (r === best.r && n >= best.n)) best = { d: date, r, n }
    }
  }
  return { done, planned, rate: planned ? Math.round((done / planned) * 100) : null, best: best ? WD[parse(best.d).getUTCDay()] : null }
}

/**
 * Reminders due at local time `m` (minutes since midnight) on `today`.
 * Each has a stable key; callers send a key at most once.
 */
export function dueReminders(o: {
  tasks: RTask[]
  s: RSettings
  today: string
  m: number
  weekday: number // 0 = Sunday
  dom: number // day of month
  recapWeek: () => Recap
  recapPrevMonth: () => Recap
}): Due[] {
  const { s, today, m } = o
  const out: Due[] = []
  const quiet = s.quiet && (m >= 22 * 60 || m < 7 * 60)
  const todays = o.tasks.filter((t) => t.date === today && !t.done && !t.skipped)
  const taskActions: Action[] = [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 10 min' }]

  for (const t of todays) {
    if (!t.start_time) continue
    if (quiet && !(t.urgent && s.urgent_through)) continue
    const st = toMin(t.start_time)
    const en = st + (t.duration_min ?? 0)
    const lead = t.reminder === '10' ? 10 : t.reminder === '30' ? 30 : 0
    const len = t.duration_min ? ` · ${durTxt(t.duration_min)}` : ''
    if (s.before_start && lead && m >= st - lead && m < st)
      out.push({ key: `${today}:${t.id}:pre`, title: `Coming up at ${t.start_time}`, body: `${t.title}${len}`, taskId: t.id, actions: [{ action: 'open', title: 'Open' }, { action: 'snooze', title: 'Snooze 10 min' }] })
    if (s.at_start && t.reminder !== 'none' && m >= st && m < st + 5)
      out.push({ key: `${today}:${t.id}:start`, title: 'Starting now', body: `${t.title}${t.duration_min ? ` · until ${fmt(en)}` : ''}`, taskId: t.id, actions: taskActions })
    if (s.nudge && m >= en + 30 && m < en + 180)
      out.push({ key: `${today}:${t.id}:nudge`, title: 'Still waiting for you', body: `${t.title}, from ${t.start_time}`, taskId: t.id, actions: [{ action: 'done', title: 'Done' }, { action: 'tomorrow', title: 'Move to tomorrow' }] })
  }
  if (quiet) return out

  const untimed = todays.filter((t) => !t.start_time)
  if (s.morning && untimed.length && m >= 480 && m < 510)
    out.push({ key: `${today}:morning`, title: 'Good morning', body: `No set time today: ${list(untimed)}` })
  if (s.evening && untimed.length && m >= 1200 && m < 1230)
    out.push({ key: `${today}:evening`, title: 'Still open today', body: list(untimed) })
  if (s.weekly && o.weekday === 0 && m >= 1140 && m < 1170) {
    const r = o.recapWeek()
    if (r.planned) out.push({ key: `${today}:weekly`, title: 'This week', body: `${r.done} of ${r.planned} done.${r.best ? ` Your best was ${r.best}.` : ''}` })
  }
  if (s.monthly && o.dom === 1 && m >= 540 && m < 570) {
    const r = o.recapPrevMonth()
    if (r.planned) out.push({ key: `${today}:monthly`, title: `${monthName(addDaysISO(today, -1))} recap`, body: `${r.done} of ${r.planned} done · ${r.rate}% completed.` })
  }
  return out
}

/* ---------------- repeating tasks ---------------- */

export interface Rule { repeat: string; repeat_days: number | null }
export interface SeriesRow extends Rule { id: string; series_id: string | null; date: string }

const wdMon = (s: string) => (parse(s).getUTCDay() + 6) % 7 // Monday = 0

/** Whether a task repeating by `rule`, anchored on `anchor` (for "every week"), happens on `date`. */
export function occursOn(rule: Rule, anchor: string, date: string) {
  const wd = wdMon(date)
  switch (rule.repeat) {
    case 'daily': return true
    case 'weekdays': return wd < 5
    case 'weekly': return wd === wdMon(anchor)
    case 'custom': return Boolean((rule.repeat_days ?? 0) & (1 << wd))
    default: return false
  }
}

/**
 * Days in `dates` where a repeating series should have a task but has none.
 * The newest day of each series is the template (it carries the latest edits);
 * a series whose newest day says "never" has stopped. Nothing is made before a series began.
 */
export function missingOccurrences<T extends SeriesRow>(tasks: T[], dates: string[]): { template: T; date: string }[] {
  const series = new Map<string, T[]>()
  for (const t of tasks) if (t.series_id) series.set(t.series_id, [...(series.get(t.series_id) ?? []), t])
  const out: { template: T; date: string }[] = []
  for (const list of series.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    const template = list[list.length - 1]
    if (template.repeat === 'never') continue
    const start = list[0].date
    const have = new Set(list.map((t) => t.date))
    for (const date of dates) if (date >= start && !have.has(date) && occursOn(template, template.date, date)) out.push({ template, date })
  }
  return out
}
