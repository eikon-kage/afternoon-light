export type Reminder = 'start' | '10' | '30' | 'none'
export type Repeat = 'never' | 'daily' | 'weekdays' | 'weekly' | 'custom'

export interface Group {
  id: string
  name: string
  color: string
  position: number
}

export interface Task {
  id: string
  group_id: string | null
  title: string
  date: string // YYYY-MM-DD, local
  start_time: string | null // HH:MM
  duration_min: number | null
  reminder: Reminder
  repeat: Repeat
  notes: string
  urgent: boolean
  done: boolean
  done_at: string | null
  series_id: string | null // shared by every day of a repeating task
  repeat_days: number | null // custom repeat: bitmask, Monday = 1 … Sunday = 64
  skipped: boolean // one day of a series removed on its own
}

export interface Settings {
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

export type Draft = Partial<Task> & { id?: string }

export const PALETTE = ['#FF6B47', '#FFC58F', '#FFDDB8', '#9DBE9F', '#7FA287', '#D98C7A', '#8A5A44']

export const DEFAULT_GROUPS = [
  { name: 'Work', color: '#FF6B47' },
  { name: 'Personal', color: '#9DBE9F' },
  { name: 'Errands', color: '#FFC58F' },
]

export const INBOX: Group = { id: 'inbox', name: 'Inbox', color: '#D98C7A', position: 999 }
