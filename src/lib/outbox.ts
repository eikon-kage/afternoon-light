import { supabase } from './supabase'

export type Table = 'tasks' | 'groups' | 'notification_settings'
export interface Op {
  table: Table
  kind: 'insert' | 'update' | 'delete'
  id: string // row id, or user_id for notification_settings
  payload?: object
}

const keyOf = (uid: string) => `al:outbox:${uid}`
const keyCol = (t: Table) => (t === 'notification_settings' ? 'user_id' : 'id')

export const isNetworkError = (msg: string) =>
  !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)

/**
 * Durable queue of writes. Ops survive reloads and going offline, are merged where possible
 * (insert+update → insert, insert+delete → nothing) and are sent one at a time, in order.
 */
export class Outbox {
  private ops: Op[]
  private running = false
  constructor(
    private uid: string,
    private onChange: (pending: number) => void,
    private onRejected: (message: string) => void,
    private onDuplicate: () => void = () => {},
  ) {
    this.ops = this.read()
  }

  get pending() {
    return this.ops
  }

  push(op: Op) {
    const same = (o: Op) => o.table === op.table && o.id === op.id
    const prev = [...this.ops].reverse().find(same)
    const inflight = this.running && prev === this.ops[0] // already sent; must not change under it
    if (prev && !inflight && op.kind === 'update' && prev.kind !== 'delete') {
      prev.payload = { ...prev.payload, ...op.payload }
    } else if (prev && !inflight && op.kind === 'delete' && prev.kind === 'insert') {
      this.ops = this.ops.filter((o) => !same(o))
    } else {
      this.ops.push(op)
    }
    this.save()
    this.flush()
  }

  async flush() {
    if (this.running) return
    this.running = true
    try {
      while (this.ops.length) {
        const op = this.ops[0]
        const { error } = await exec(op)
        if (error && isNetworkError(error.message)) break // keep it; retried when back online
        this.ops.shift()
        this.save()
        // 23505: the row exists already — an earlier attempt landed, or another device made the same
        // day of a repeating task first. Either way the server copy wins; reload to drop ours.
        if (error?.code === '23505') this.onDuplicate()
        else if (error) this.onRejected(error.message)
      }
    } finally {
      this.running = false
    }
  }

  private read(): Op[] {
    try {
      return JSON.parse(localStorage.getItem(keyOf(this.uid)) || '[]')
    } catch {
      return []
    }
  }
  private save() {
    try {
      localStorage.setItem(keyOf(this.uid), JSON.stringify(this.ops))
    } catch {
      /* storage full or blocked: ops still live in memory for this session */
    }
    this.onChange(this.ops.length)
  }
}

function exec(op: Op): PromiseLike<{ error: { message: string; code?: string } | null }> {
  const q = supabase.from(op.table)
  if (op.kind === 'insert') return q.insert(op.payload as Record<string, unknown>)
  if (op.kind === 'update') return q.update(op.payload as Record<string, unknown>).eq(keyCol(op.table), op.id)
  return q.delete().eq(keyCol(op.table), op.id)
}

/** Re-applies queued ops on top of rows fresh from the server, so unsent edits are not lost on reload. */
export function applyPending<T extends { id: string }>(rows: T[], ops: Op[], table: Table): T[] {
  let out = rows.slice()
  for (const op of ops) {
    if (op.table !== table) continue
    if (op.kind === 'delete') out = out.filter((r) => r.id !== op.id)
    else if (op.kind === 'insert') {
      if (!out.some((r) => r.id === op.id)) out.push(op.payload as unknown as T)
    } else out = out.map((r) => (r.id === op.id ? { ...r, ...op.payload } : r))
  }
  return out
}
