import { useEffect, useRef, useState } from 'react'
import type { Ctx } from '../ctx'
import { groupOf } from '../ctx'
import { INBOX, type Task } from '../types'
import { Capsule, Check, GroupsManager, SettingsView, StatsView, syncLabel } from './shared'
import { capsuleInfo, repeatLabel, rowStates, streak, type RowState } from '../lib/status'
import { addDays, durTxt, fmt, label, toMin, weekDays } from '../lib/time'

type Tab = 'Today' | 'Week' | 'Stats' | 'Settings'

export function MobileApp({ ctx, toast }: { ctx: Ctx; toast: { title: string; body: string; taskId?: string } | null }) {
  const [tab, setTab] = useState<Tab>('Today')
  const [date, setDate] = useState(ctx.today)
  const go = (d: string) => { setDate(d); setTab('Today') }
  return (
    <div className="m-app">
      {(ctx.data.pending > 0 || !navigator.onLine) && !ctx.demo && <div className="offline" role="status">{syncLabel(ctx)}</div>}
      {tab === 'Today' && <TodayView ctx={ctx} date={date} setDate={setDate} toast={toast} />}
      {tab === 'Week' && <WeekTab ctx={ctx} anchor={date} onPick={go} />}
      {tab === 'Stats' && (
        <>
          <Header meta={`${label(ctx.today).short}, ${label(ctx.today).n} ${label(ctx.today).mon}`} title="Stats" />
          <div className="sheet glass"><StatsView ctx={ctx} /></div>
        </>
      )}
      {tab === 'Settings' && (
        <>
          <Header meta="Settings" title="Notifications" />
          <div className="sheet glass"><SettingsView ctx={ctx} showGroups={false} /></div>
        </>
      )}
      <nav className="tabs" aria-label="Sections">
        {(['Today', 'Week', 'Stats', 'Settings'] as Tab[]).map((t) => (
          <button type="button" key={t} className={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined}
            onClick={() => { setTab(t); if (t === 'Today') setDate(ctx.today) }}>{t}</button>
        ))}
      </nav>
    </div>
  )
}

function Header({ meta, title, sub }: { meta: string; title: string; sub?: string }) {
  return (
    <header className="hd">
      <div className="meta">{meta}</div>
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
    </header>
  )
}

function WeekStrip({ ctx, date, setDate }: { ctx: Ctx; date: string; setDate: (d: string, dir?: number) => void }) {
  const days = weekDays(date)
  const startX = useRef<number | null>(null)
  return (
    <div className="weekbar"
      onPointerDown={(e) => { startX.current = e.clientX }}
      onPointerUp={(e) => {
        if (startX.current === null) return
        const dx = e.clientX - startX.current
        startX.current = null
        if (Math.abs(dx) > 50) setDate(addDays(date, dx < 0 ? 7 : -7), dx < 0 ? 1 : -1)
      }}>
      <button type="button" className="nav" aria-label="Previous week" onClick={() => setDate(addDays(date, -7), -1)}>‹</button>
      <div className="week" role="group" aria-label="Pick a day">
        {days.map((d) => {
          const has = ctx.data.tasks.some((t) => t.date === d)
          const l = label(d)
          return (
            <button type="button" key={d} className={`wd${d === date ? ' sel' : ''}${has ? ' has' : ''}${d === ctx.today ? ' is-today' : ''}`}
              aria-pressed={d === date} aria-label={`${l.full} ${l.n} ${l.mon}`} onClick={() => setDate(d, d > date ? 1 : -1)}>
              {l.short}<b>{l.n}</b>
            </button>
          )
        })}
      </div>
      <button type="button" className="nav" aria-label="Next week" onClick={() => setDate(addDays(date, 7), 1)}>›</button>
    </div>
  )
}

function TodayView({ ctx, date, setDate, toast }: { ctx: Ctx; date: string; setDate: (d: string) => void; toast: { title: string; body: string; taskId?: string } | null }) {
  const { data, today, m } = ctx
  const [dir, setDir] = useState(0)
  const [quick, setQuick] = useState('')
  const isToday = date === today
  const l = label(date)
  const list = data.tasks.filter((t) => t.date === date)
  const open = list.filter((t) => !t.done).length
  const states = rowStates(list, date, today, m)
  const cap = isToday ? capsuleInfo(list, m) : null
  const pick = (d: string, dirn = 0) => { setDir(dirn); setDate(d) }
  const { ensure } = data
  useEffect(() => { ensure(weekDays(date)) }, [date, ensure])
  const sections = [...data.groups, INBOX].map((g) => ({
    g,
    items: list.filter((t) => (g.id === 'inbox' ? !data.groups.some((x) => x.id === t.group_id) : t.group_id === g.id))
      .sort((a, b) => (a.start_time ? toMin(a.start_time) : 9999) - (b.start_time ? toMin(b.start_time) : 9999)),
  })).filter((s) => s.items.length)

  return (
    <>
      <Header meta={`${l.short}, ${l.n} ${l.mon}${isToday ? ` · ${fmt(m)}` : ''}`} title={isToday ? 'Today' : l.full}
        sub={list.length ? (open ? `${open} task${open > 1 ? 's' : ''} left` : 'All done') : 'Nothing planned'} />
      <WeekStrip ctx={ctx} date={date} setDate={pick} />
      {toast ? (
        <Capsule className="toast" text={`${toast.title}: ${toast.body}`} onClick={() => {
          const t = data.tasks.find((x) => x.id === toast.taskId)
          if (t) ctx.open(t)
        }} />
      ) : cap && <Capsule text={cap.text} right={cap.right} onClick={() => ctx.open(cap.task)} />}
      <div className="sheet glass">
        {sections.length ? (
          <ul key={date} className={`list${dir ? (dir > 0 ? ' in-r' : ' in-l') : ''}`}>
            {sections.map(({ g, items }) => {
              const o = items.filter((t) => !t.done).length
              if (!o && items.length > 1) return [
                <li key={g.id} className="gl"><span>{g.name}</span><span>All done</span></li>,
                <li key={g.id + 'c'} className="collapsed">{items.length} tasks finished</li>,
              ]
              return [
                <li key={g.id} className="gl"><span>{g.name}</span><span>{o}</span></li>,
                ...items.map((t) => <TaskRow key={t.id} ctx={ctx} t={t} s={states.get(t.id)!} />),
              ]
            })}
          </ul>
        ) : (
          <div className="empty">
            <div className="sun" aria-hidden="true" />
            <b>Nothing planned for {isToday ? 'today' : l.full}.</b>
            <p>Enjoy the space, or plan one small thing.</p>
            <button type="button" className="soft" onClick={() => ctx.open({ date })}>Add a task</button>
          </div>
        )}
        <form className="add" onSubmit={(e) => {
          e.preventDefault()
          const v = quick.trim()
          if (!v) { ctx.open({ date }); return }
          data.addTask({ title: v, date, group_id: null, start_time: null, duration_min: null, reminder: '10', repeat: 'never', notes: '', urgent: false, done: false, done_at: null, series_id: null, repeat_days: null, skipped: false })
          setQuick('')
        }}>
          <input id="quickAdd" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task" aria-label="Add a task" />
          <button className="ink" type="submit">Add</button>
        </form>
      </div>
    </>
  )
}

/** Row with swipe: right completes, left moves to tomorrow. */
function TaskRow({ ctx, t, s }: { ctx: Ctx; t: Task; s: RowState }) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number; on: boolean } | null>(null)
  const swiped = useRef(false) // a swipe must not also open the task
  const st = t.start_time ? toMin(t.start_time) : 0
  return (
    <li className={`row${t.done ? ' done' : ''}${s.st ? ' ' + s.st : ''}${dx ? ' dragging' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      data-hint={dx > 40 ? 'Done' : dx < -40 ? 'Tomorrow' : undefined}
      onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY, on: false }; swiped.current = false }}
      onPointerMove={(e) => {
        const p = start.current
        if (!p) return
        const ddx = e.clientX - p.x
        if (!p.on && Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(e.clientY - p.y)) p.on = true
        if (p.on) setDx(Math.max(-120, Math.min(120, ddx)))
      }}
      onPointerUp={() => {
        const p = start.current
        start.current = null
        if (p?.on) {
          swiped.current = true
          if (dx > 80) ctx.data.toggleDone(t)
          else if (dx < -80) ctx.data.moveToTomorrow(t)
        }
        setDx(0)
      }}
      onPointerCancel={() => { start.current = null; setDx(0) }}>
      <Check done={t.done} progress={s.st === 'run' ? s.progress : undefined} onToggle={() => ctx.data.toggleDone(t)} title={t.title} />
      <button type="button" className="rb" onClick={() => { if (swiped.current) swiped.current = false; else ctx.open(t) }}>
        <span className="rt-t">{t.urgent && <span className="urg" aria-label="Urgent">!</span>}{t.title}</span>
        <span className="rm">
          {t.start_time ? (
            <>
              <span className={s.st === 'next' ? 'nx' : ''}>{t.duration_min ? `${t.start_time}–${fmt(st + t.duration_min)}` : t.start_time}</span>
              {t.duration_min && <span>· {durTxt(t.duration_min)}</span>}
            </>
          ) : <span>Anytime</span>}
          {s.lateText && <span className="late">{s.lateText}</span>}
          {t.series_id && t.repeat !== 'never' && <span className="rep">· ↻ {repeatLabel(t)}</span>}
          {(() => { const n = t.series_id ? streak(ctx.data.allTasks, t, ctx.today) : 0; return n >= 2 ? <span className="streak">· {n}-day streak</span> : null })()}
        </span>
      </button>
    </li>
  )
}

function WeekTab({ ctx, anchor, onPick }: { ctx: Ctx; anchor: string; onPick: (d: string) => void }) {
  const [seg, setSeg] = useState<'days' | 'groups'>('days')
  const [a, setA] = useState(anchor)
  const days = weekDays(a)
  const f = label(days[0]), t = label(days[6])
  const { ensure } = ctx.data
  useEffect(() => { ensure(weekDays(a)) }, [a, ensure])
  return (
    <>
      <Header meta={f.mon === t.mon ? `${f.n}–${t.n} ${t.mon}` : `${f.n} ${f.mon} – ${t.n} ${t.mon}`} title={seg === 'days' ? 'This week' : 'Groups'} />
      <div className="sheet glass">
        <div className="sseg" role="group" aria-label="View">
          <button type="button" className={seg === 'days' ? 'on' : ''} onClick={() => setSeg('days')}>Days</button>
          <button type="button" className={seg === 'groups' ? 'on' : ''} onClick={() => setSeg('groups')}>Groups</button>
        </div>
        {seg === 'groups' ? <GroupsManager ctx={ctx} /> : (
          <>
            <div className="period">
              <button type="button" className="nav" aria-label="Previous week" onClick={() => setA(addDays(a, -7))}>‹</button>
              <span>Week of {f.n} {f.mon}</span>
              <button type="button" className="nav" aria-label="Next week" onClick={() => setA(addDays(a, 7))}>›</button>
            </div>
            {days.map((d) => {
              const l = label(d)
              const items = ctx.data.tasks.filter((x) => x.date === d).sort((x, y) => (x.start_time ?? '99').localeCompare(y.start_time ?? '99'))
              return (
                <div key={d} className="agenda">
                  <button type="button" className={`ag-h${d === ctx.today ? ' is-today' : ''}`} onClick={() => onPick(d)}>
                    <span>{l.full} <b>{l.n}</b></span>
                    <span>{items.length ? `${items.filter((x) => x.done).length}/${items.length} done` : 'Free'}</span>
                  </button>
                  {items.slice(0, 4).map((x) => (
                    <button type="button" key={x.id} className={`ag-i${x.done ? ' done' : ''}`} onClick={() => ctx.open(x)}>
                      <i style={{ background: groupOf(ctx.data.groups, x.group_id).color }} />
                      <span>{x.start_time ?? 'Anytime'}</span>{x.title}
                    </button>
                  ))}
                  {items.length > 4 && <button type="button" className="ag-more" onClick={() => onPick(d)}>+{items.length - 4} more</button>}
                </div>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}
