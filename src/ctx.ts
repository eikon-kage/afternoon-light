import type { Data } from './lib/store'
import type { Draft, Group } from './types'
import { INBOX } from './types'

export interface Ctx {
  data: Data
  now: Date
  today: string
  m: number // minutes since midnight
  open: (draft: Draft) => void
  rt: boolean
  setRt: (v: boolean) => void
  email: string
  demo: boolean
  signOut: () => void | Promise<void>
}

export const groupOf = (groups: Group[], id: string | null) => groups.find((g) => g.id === id) ?? INBOX
