import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ctx } from '../ctx'
import { groupOf } from '../ctx'
import { INBOX, type Task } from '../types'
import { Capsule, Check, SettingsView, StatsView, gcStyle, syncLabel } from './shared'
import { repeatLabel, rowStates } from '../lib/status'
import { addDays, addMonths, durTxt, fmt, gmtLabel, label, monthGrid, toMin, weekDays } from '../lib/time'

type View = 'day' | 'week' | 'month' | 'stats' | 'settings'
const H = 56 // px per hour in the time grid

export function DesktopApp({ ctx, toast }: { ctx: Ctx; toast: { title: string; body: string; taskId?: string } | null }) {
  const { data, today } = ctx
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)

  const days = view === 'day' ? [anchor] : weekDays(anchor)
  const step = (dir: number) =>
    setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * 7))
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.tasks.filter((t) => !hidden.has(t.group_id ?? 'inbox') && (!needle || t.title.toLowerCase().includes(needle) || t.notes.toLowerCase().includes(needle)))
  }, [data.tasks, hidden, q])
  const pickDay = (d: string) => { setAnchor(d); setView('day') }
  const { ensure } = data
  useEffect(() => { ensure(view === 'month' ? monthGrid(anchor) : view === 'day' ? [anchor] : weekDays(anchor)) }, [view, anchor, ensure])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.documentElement.classList.contains('modal-open')) return
      const k = e.key.toLowerCase()
      if (k === 'n') { e.preventDefault(); ctx.open({ date: anchor }) }
      else if (k === 't') setAnchor(today)
      else if (k === 'd') setView('day')
      else if (k === 'w') setView('week')
      else if (k === 'm') setView('month')
      else if (k === 'arrowleft') step(-1)
      else if (k === 'arrowright') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const first = label(view === 'month' ? anchor : days[0]), last = label(days[days.length - 1])
  const title = view === 'month' || view === 'stats' || view === 'settings' || first.month === last.month
    ? `${first.month} ${first.year}` : `${first.mon} – ${last.mon} ${last.year}`
  const initials = ctx.email.split('@')[0].split(/[._-]/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="d-app">
      <header className="topbar">
        <span className="appicon logo" aria-hidden="true" />
        <h1>{title.split(' ').slice(0, -1).join(' ')} <span>{title.split(' ').slice(-1)}</span></h1>
        <button type="button" className="soft" onClick={() => setAnchor(today)}>Today</button>
        <button type="button" className="nav" aria-label="Previous" onClick={() => step(-1)}>‹</button>
        <button type="button" className="nav" aria-label="Next" onClick={() => step(1)}>›</button>
        <span className="spacer" />
        <div className="sseg top" role="group" aria-label="View">
          {(['day', 'week', 'month', 'stats'] as View[]).map((v) => (
            <button type="button" key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        {searching ? (
          <input id="search" className="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
            onBlur={() => !q && setSearching(false)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setSearching(false) } }} />
        ) : (
          <button type="button" className="icon" aria-label="Search" onClick={() => setSearching(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </button>
        )}
        <button type="button" className="ink" onClick={() => ctx.open({ date: anchor })}>+ New task</button>
        <button type="button" className={`avatar${view === 'settings' ? ' on' : ''}`} aria-label="Settings and account" onClick={() => setView(view === 'settings' ? 'week' : 'settings')}>{initials || '·'}</button>
      </header>

      <aside className="sidebar">
        <MiniMonth anchor={anchor} today={today} week={view === 'week' ? weekDays(anchor) : [anchor]} onPick={(d) => { setAnchor(d); if (view === 'month' || view === 'stats' || view === 'settings') setView('week') }} />
        <div className="sb-sec">
          <div className="sec">My groups</div>
          {[...data.groups, INBOX].map((g) => {
            const key = g.id
            const on = !hidden.has(key)
            return (
              <button type="button" key={g.id} className={`sb-g${on ? '' : ' off'}`} style={gcStyle(g.color)} aria-pressed={on}
                onClick={() => setHidden((h) => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n })}>
                <i />{g.name}
              </button>
            )
          })}
        </div>
        <UpNext ctx={ctx} />
        <div className="sb-foot" role="status"><span className={`live${data.live && !data.pending ? ' on' : ''}`} />{syncLabel(ctx)}</div>
      </aside>

      <main className="surface glass">
        {(view === 'week' || view === 'day') && <TimeGrid ctx={ctx} days={days} tasks={visible} onPickDay={pickDay} />}
        {view === 'month' && <MonthGrid ctx={ctx} anchor={anchor} tasks={visible} onPickDay={pickDay} />}
        {view === 'stats' && <div className="pad"><StatsView ctx={ctx} wide /></div>}
        {view === 'settings' && <div className="pad narrow"><h2 className="ptitle">Settings</h2><SettingsView ctx={ctx} /></div>}
      </main>

      {toast && <Capsule className="toast floating" text={`${toast.title}: ${toast.body}`} onClick={() => {
        const t = data.tasks.find((x) => x.id === toast.taskId)
        if (t) ctx.open(t)
      }} />}
    </div>
  )
}

function MiniMonth({ anchor, today, week, onPick }: { anchor: string; today: string; week: string[]; onPick: (d: string) => void }) {
  const [m, setM] = useState(anchor)
  useEffect(() => setM(anchor), [anchor])
  const l = label(m)
  return (
    <div className="mini-month">
      <div className="mm-h">
        <b>{l.month} {l.year}</b>
        <span>
          <button type="button" className="nav sm" aria-label="Previous month" onClick={() => setM(addMonths(m, -1))}>‹</button>
          <button type="button" className="nav sm" aria-label="Next month" onClick={() => setM(addMonths(m, 1))}>›</button>
        </span>
      </div>
      <div className="mm-g">
        {'MTWTFSS'.split('').map((w, i) => <span key={i} className="w">{w}</span>)}
        {monthGrid(m).map((d) => {
          const inMonth = label(d).month === l.month
          return (
            <button type="button" key={d} className={`${inMonth ? '' : 'out'}${week.includes(d) ? ' wk' : ''}${d === today ? ' today' : ''}`}
              aria-label={`${label(d).full} ${label(d).n} ${label(d).mon}`} onClick={() => onPick(d)}>
              {label(d).n}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function UpNext({ ctx }: { ctx: Ctx }) {
  const { data, today, m } = ctx
  const tomorrow = addDays(today, 1)
  const items = data.tasks
    .filter((t) => !t.done && t.start_time && ((t.date === today && toMin(t.start_time) + (t.duration_min ?? 0) > m) || t.date === tomorrow))
    .sort((a, b) => (a.date + a.start_time!).localeCompare(b.date + b.start_time!))
    .slice(0, 4)
  return (
    <div className="sb-sec">
      <div className="sec">Up next</div>
      {items.length ? items.map((t) => {
        const g = groupOf(data.groups, t.group_id)
        return (
          <button type="button" key={t.id} className="un" style={gcStyle(g.color)} onClick={() => ctx.open(t)}>
            <span className="un-t">{t.start_time}{t.date !== today && <small>Tomorrow</small>}</span>
            <span className="un-b"><b>{t.title}</b><small>{g.name}{t.duration_min ? ` · ${durTxt(t.duration_min)}` : ''}</small></span>
          </button>
        )
      }) : <p className="hint">Nothing else with a time today.</p>}
    </div>
  )
}

interface Placed { t: Task; start: number; dur: number; lane: number; lanes: number }

/** Side-by-side lanes for overlapping tasks in one day. */
function layout(items: { t: Task; start: number; dur: number }[]): Placed[] {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.dur - a.dur)
  const out: Placed[] = []
  let cluster: Placed[] = [], ends: number[] = [], clusterEnd = -1
  const flush = () => { cluster.forEach((p) => (p.lanes = ends.length)); cluster = []; ends = [] }
  for (const it of sorted) {
    const visEnd = it.start + Math.max(it.dur, 30)
    if (it.start >= clusterEnd) flush()
    let lane = ends.findIndex((e) => e <= it.start)
    if (lane < 0) { lane = ends.length; ends.push(visEnd) } else ends[lane] = visEnd
    const p = { ...it, lane, lanes: 1 }
    cluster.push(p)
    out.push(p)
    clusterEnd = Math.max(clusterEnd, visEnd)
  }
  flush()
  return out
}

function TimeGrid({ ctx, days, tasks, onPickDay }: { ctx: Ctx; days: string[]; tasks: Task[]; onPickDay: (d: string) => void }) {
  const { data, today, m } = ctx
  const body = useRef<HTMLDivElement>(null)
  const drag = useRef<{ t: Task; mode: 'move' | 'resize'; x0: number; y0: number; di: number; moved: boolean } | null>(null)
  const [preview, setPreview] = useState<{ id: string; date: string; start: number; dur: number } | null>(null)
  const justDragged = useRef(false) // the click that ends a drag must not open the task

  useEffect(() => { if (body.current) body.current.scrollTop = 7 * H - 8 }, [])

  const eff = (t: Task) =>
    preview?.id === t.id ? preview : { id: t.id, date: t.date, start: toMin(t.start_time!), dur: t.duration_min ?? 30 }

  const colW = () => {
    const el = body.current?.querySelector('.tg-col') as HTMLElement | null
    return el?.getBoundingClientRect().width ?? 120
  }
  const onDown = (e: React.PointerEvent, t: Task, mode: 'move' | 'resize') => {
    if ((e.target as HTMLElement).closest('.cb')) return
    e.stopPropagation()
    justDragged.current = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { t, mode, x0: e.clientX, y0: e.clientY, di: days.indexOf(t.date), moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y0, dx = e.clientX - d.x0
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    const dMin = Math.round(((dy / H) * 60) / 15) * 15
    const st0 = toMin(d.t.start_time!), dur0 = d.t.duration_min ?? 30
    if (d.mode === 'resize') setPreview({ id: d.t.id, date: d.t.date, start: st0, dur: Math.max(15, Math.min(1440 - st0, dur0 + dMin)) })
    else {
      const di = Math.max(0, Math.min(days.length - 1, d.di + Math.round(dx / colW())))
      setPreview({ id: d.t.id, date: days[di], start: Math.max(0, Math.min(1440 - dur0, st0 + dMin)), dur: dur0 })
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved && preview) data.updateTask(d.t.id, { date: preview.date, start_time: fmt(preview.start), duration_min: preview.dur })
    justDragged.current = d.moved || d.mode === 'resize'
    setPreview(null)
  }

  const untimed = (d: string) => tasks.filter((t) => t.date === d && !t.start_time)
  const hasAllDay = days.some((d) => untimed(d).length)
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }

  return (
    <div className="tgrid">
      <div className="tg-head" style={cols}>
        <span className="tz">{gmtLabel()}</span>
        {days.map((d) => {
          const l = label(d)
          const list = tasks.filter((t) => t.date === d)
          return (
            <button type="button" key={d} className={`tg-day${d === today ? ' is-today' : ''}`} onClick={() => onPickDay(d)} aria-label={`Open ${l.full} ${l.n}`}>
              <span>{l.short.toUpperCase()}</span><b>{l.n}</b>
              {list.length > 0 && <small>{list.filter((t) => t.done).length}/{list.length}</small>}
            </button>
          )
        })}
      </div>
      {hasAllDay && (
        <div className="tg-all" style={cols}>
          <span className="tz">ANYTIME</span>
          {days.map((d) => (
            <div key={d} className={`tg-allc${d === today ? ' is-today' : ''}`}>
              {untimed(d).map((t) => {
                const g = groupOf(data.groups, t.group_id)
                return (
                  <div key={t.id} className={`chipev${t.done ? ' done' : ''}`} style={gcStyle(g.color)}>
                    <Check done={t.done} onToggle={() => data.toggleDone(t)} title={t.title} />
                    <button type="button" onClick={() => ctx.open(t)}>{t.title}</button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <div className="tg-body" ref={body}>
        <div className="tg-inner" style={{ ...cols, height: 24 * H }}>
          <div className="tg-hours">
            {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * H }}>{h ? fmt(h * 60) : ''}</span>)}
          </div>
          {days.map((d) => {
            const items = tasks.filter((t) => t.start_time && eff(t).date === d).map((t) => ({ t, start: eff(t).start, dur: eff(t).dur }))
            const states = rowStates(tasks.filter((t) => t.date === d), d, today, m)
            return (
              <div key={d} className={`tg-col${d === today ? ' is-today' : ''}`}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                  const min = Math.max(0, Math.min(1410, Math.floor(((y / H) * 60) / 30) * 30))
                  ctx.open({ date: d, start_time: fmt(min), duration_min: 30 })
                }}>
                {layout(items).map(({ t, start, dur, lane, lanes }) => {
                  const g = groupOf(data.groups, t.group_id)
                  const s = states.get(t.id)
                  const short = dur < 45
                  return (
                    <div key={t.id}
                      className={`ev${t.done ? ' done' : ''}${s?.st ? ' ' + s.st : ''}${short ? ' short' : ''}${preview?.id === t.id ? ' dragging' : ''}`}
                      style={{ ...gcStyle(g.color), top: (start / 60) * H + 1, height: Math.max((Math.max(dur, 30) / 60) * H - 3, 22), left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
                      onPointerDown={(e) => onDown(e, t, 'move')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setPreview(null) }}
                      role="button" tabIndex={0} title={`${fmt(start)}–${fmt(start + dur)} · ${t.title}${t.series_id && t.repeat !== 'never' ? ` · ${repeatLabel(t)}` : ''}`} aria-label={`${t.title}, ${fmt(start)} to ${fmt(start + dur)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (justDragged.current) { justDragged.current = false; return }
                        if (!(e.target as HTMLElement).closest('.cb')) ctx.open(t)
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.open(t) } }}>
                      <div className="ev-top">
                        <b>{t.series_id && t.repeat !== 'never' && <span className="rep" aria-label={repeatLabel(t)}>↻ </span>}{t.title}</b>
                        <Check done={t.done} onToggle={() => data.toggleDone(t)} title={t.title} />
                      </div>
                      {!short && <span className="ev-m">
                        {fmt(start)}{t.duration_min ? `–${fmt(start + dur)}` : ''}{!short && ` · ${g.name}`}
                        {s?.st === 'late' && <em> · Overdue</em>}
                      </span>}
                      {t.duration_min && (
                        <span className="rz" aria-hidden="true" onPointerDown={(e) => onDown(e, t, 'resize')} onPointerMove={onMove} onPointerUp={onUp} />
                      )}
                    </div>
                  )
                })}
                {d === today && <div className="nowline" style={{ top: (m / 60) * H }} aria-hidden="true" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ ctx, anchor, tasks, onPickDay }: { ctx: Ctx; anchor: string; tasks: Task[]; onPickDay: (d: string) => void }) {
  const { data, today } = ctx
  const month = label(anchor).month
  return (
    <div className="mgrid">
      {'Mon Tue Wed Thu Fri Sat Sun'.split(' ').map((w) => <span key={w} className="mg-w">{w.toUpperCase()}</span>)}
      {monthGrid(anchor).map((d) => {
        const l = label(d)
        const items = tasks.filter((t) => t.date === d).sort((a, b) => (a.start_time ?? '99').localeCompare(b.start_time ?? '99'))
        return (
          <div key={d} className={`mg-c${l.month !== month ? ' out' : ''}${d === today ? ' is-today' : ''}`}
            onClick={(e) => { if (e.target === e.currentTarget) onPickDay(d) }}>
            <button type="button" className="mg-n" onClick={() => onPickDay(d)} aria-label={`Open ${l.full} ${l.n}`}>{l.n}</button>
            {items.slice(0, 3).map((t) => (
              <button type="button" key={t.id} className={`mg-e${t.done ? ' done' : ''}`} style={gcStyle(groupOf(data.groups, t.group_id).color)} onClick={() => ctx.open(t)}>
                <i />{t.start_time && <span>{t.start_time}</span>}{t.title}
              </button>
            ))}
            {items.length > 3 && <button type="button" className="mg-more" onClick={() => onPickDay(d)}>+{items.length - 3} more</button>}
          </div>
        )
      })}
    </div>
  )
}
