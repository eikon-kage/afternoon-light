export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s: string, n: number) => {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export const addMonths = (s: string, n: number) => {
  const d = parseISO(s)
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1))
}
export const wdIndex = (s: string) => (parseISO(s).getDay() + 6) % 7 // Monday = 0
export const startOfWeek = (s: string) => addDays(s, -wdIndex(s))
export const weekDays = (s: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(s), i))
export const monthDays = (s: string) => {
  const d = parseISO(s)
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Array.from({ length: n }, (_, i) => iso(new Date(d.getFullYear(), d.getMonth(), i + 1)))
}
/** Full weeks (Mon–Sun) covering the month of `s`. */
export const monthGrid = (s: string) => {
  const days = monthDays(s)
  const first = startOfWeek(days[0])
  const last = addDays(startOfWeek(days[days.length - 1]), 6)
  const out: string[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
  return out
}

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
export const fmt = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(((m % 60) + 60) % 60)}`
export const durTxt = (d: number) =>
  d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`
export const leftTxt = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)} h ${m % 60}m`)
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes()

export const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WD_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MONTH_SHORT = MONTH.map((m) => m.slice(0, 3))

export const label = (s: string) => {
  const d = parseISO(s)
  const w = wdIndex(s)
  return {
    short: WD_SHORT[w],
    full: WD_FULL[w],
    n: d.getDate(),
    mon: MONTH_SHORT[d.getMonth()],
    month: MONTH[d.getMonth()],
    year: d.getFullYear(),
  }
}

export type Phase = 'morning' | 'afternoon' | 'evening' | 'night'
export const phaseOf = (h: number): Phase =>
  h >= 6 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night'

export const gmtLabel = () => {
  const o = -new Date().getTimezoneOffset() / 60
  return `GMT${o >= 0 ? '+' : ''}${o}`
}
