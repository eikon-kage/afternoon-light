import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Ctx } from '../ctx'
import { groupOf } from '../ctx'
import { INBOX, PALETTE, type Settings } from '../types'
import { periodStats } from '../lib/stats'
import { addDays, addMonths, label, monthDays, monthGrid, weekDays } from '../lib/time'
import { currentSubscription, disablePush, enablePush, pushConfigured, pushSupported } from '../lib/push'

export function LightField() {
  return (
    <div className="field" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}

/** One line describing sync state: demo, offline with queued changes, sending, or live. */
export function syncLabel(ctx: Ctx) {
  const { data } = ctx
  if (ctx.demo) return 'Demo · saved in this browser'
  if (data.pending) return `${navigator.onLine ? 'Saving' : 'Offline'} · ${data.pending} change${data.pending > 1 ? 's' : ''} waiting`
  return data.live ? 'Synced with Supabase' : 'Reconnecting…'
}

export function Switch({ on, onChange, label: l }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="sw2" role="switch" aria-checked={on} aria-label={l} onClick={() => onChange(!on)} />
}

/** Round checkbox with ripple; shows a progress ring while the task is running. */
export function Check({ done, progress, onToggle, title }: { done: boolean; progress?: number; onToggle: () => void; title: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className={`cb${done ? ' on' : ''}`}
      aria-pressed={done}
      aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${title}`}
      onClick={(e) => {
        e.stopPropagation()
        const b = ref.current
        if (b) {
          b.classList.remove('pop')
          void b.offsetWidth
          b.classList.add('pop')
        }
        navigator.vibrate?.(8)
        onToggle()
      }}
    >
      {progress !== undefined && progress > 0 && !done && (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--track)" strokeWidth="2" />
          <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--coral)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${(91.1 * progress).toFixed(1)} 91.1`} />
        </svg>
      )}
    </button>
  )
}

export function Capsule({ text, right, onClick, className = '' }: { text: string; right?: string; onClick?: () => void; className?: string }) {
  return (
    <button type="button" className={`capsule glass ${className}`} onClick={onClick} role="status">
      <span className="dot" />
      <span className="ct">{text}</span>
      {right && <span className="r">{right}</span>}
    </button>
  )
}

/* ---------------- Stats ---------------- */

export function StatsView({ ctx, wide = false }: { ctx: Ctx; wide?: boolean }) {
  const { data, today } = ctx
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(today)
  const isWeek = range === 'week'
  const dates = isWeek ? weekDays(anchor) : monthDays(anchor)
  const prev = isWeek ? weekDays(addDays(anchor, -7)) : monthDays(addMonths(anchor, -1))
  const s = periodStats(data.tasks, dates, today)
  const ps = periodStats(data.tasks, prev, today)
  const delta = s.rate !== null && ps.rate !== null ? s.rate - ps.rate : null
  const a = label(dates[0]), b = label(dates[dates.length - 1])
  const title = isWeek ? (a.mon === b.mon ? `${a.n}–${b.n} ${b.mon}` : `${a.n} ${a.mon} – ${b.n} ${b.mon}`) : `${a.month} ${a.year}`
  const step = (dir: number) => setAnchor(isWeek ? addDays(anchor, dir * 7) : addMonths(anchor, dir))
  const maxP = Math.max(1, ...s.days.map((d) => d.p))
  const groups = [...data.groups, INBOX]
    .map((g) => ({ g, v: s.groups.get(g.id === 'inbox' ? null : g.id) }))
    .filter((x) => x.v && x.v.p)

  const chart = isWeek ? (
    <div className="bars" role="img" aria-label="Tasks done per day">
      {s.days.map((d) => (
        <div key={d.date} className={`bc${d.future ? ' fut' : ''}${d.date === today ? ' today' : ''}`} title={`${label(d.date).full}: ${d.d} of ${d.p} done`}>
          <em>{d.future ? (d.p ? `${d.p} planned` : '') : `${d.d}/${d.p}`}</em>
          <div className="bt" style={{ height: `${Math.max((d.p / maxP) * 100, 4)}%` }}>
            {!d.future && <i style={{ height: `${d.p ? (d.d / d.p) * 100 : 0}%` }} />}
          </div>
          <span>{label(d.date).short.slice(0, 1)}</span>
        </div>
      ))}
    </div>
  ) : (
    <>
      <div className="cal" role="img" aria-label="Completion calendar">
        {'MTWTFSS'.split('').map((w, i) => <span key={i} className="w">{w}</span>)}
        {monthGrid(anchor).map((date) => {
          const d = s.days.find((x) => x.date === date)
          if (!d) return <span key={date} className="hc blank" />
          const r = d.p ? d.d / d.p : 0
          const lvl = d.future ? 'fut' : !d.p ? 'l0' : r >= 1 ? 'l4' : r >= 0.75 ? 'l3' : r >= 0.5 ? 'l2' : 'l1'
          return (
            <span key={date} className={`hc ${lvl}${date === today ? ' today' : ''}`}
              title={`${label(date).n} ${label(date).mon} · ${d.future ? `${d.p} planned` : `${d.d} of ${d.p} done`}`}>
              {label(date).n}
            </span>
          )
        })}
      </div>
      <div className="legend"><span>Less</span><span className="hc l1" /><span className="hc l2" /><span className="hc l3" /><span className="hc l4" /><span>More</span></div>
    </>
  )

  const head = (
    <>
      <div className="sseg" role="group" aria-label="Period">
        <button type="button" className={isWeek ? 'on' : ''} onClick={() => { setRange('week'); setAnchor(today) }}>This week</button>
        <button type="button" className={!isWeek ? 'on' : ''} onClick={() => { setRange('month'); setAnchor(today) }}>{label(today).month}</button>
      </div>
      <div className="period">
        <button type="button" className="nav" aria-label="Previous" onClick={() => step(-1)}>‹</button>
        <span>{title}</span>
        <button type="button" className="nav" aria-label="Next" onClick={() => step(1)}>›</button>
      </div>
      <div className="kpi">
        <div className="n">{s.rate === null ? '—' : `${s.rate}%`}</div>
        <div className="k">
          completed
          <small>{s.planned ? `${s.done} of ${s.planned} tasks so far` : 'Nothing planned yet'}</small>
          {delta !== null && <small className="up">{delta >= 0 ? '+' : '−'}{Math.abs(delta)} pts vs {isWeek ? 'last week' : label(prev[0]).month}</small>}
        </div>
      </div>
    </>
  )
  const side = (
    <>
      <div className="mini3">
        <div><b>{s.ontime === null ? '—' : `${s.ontime}%`}</b><span>On time</span></div>
        <div><b>{s.perDay.toFixed(1)}</b><span>Done per day</span></div>
        <div><b>{s.best ? (isWeek ? label(s.best.date).short : `${label(s.best.date).n} ${label(s.best.date).mon}`) : '—'}</b><span>Best day</span></div>
      </div>
      <div className="gbars">
        {groups.length ? groups.map(({ g, v }) => (
          <div className="gb" key={g.id}>
            <span><i style={{ background: g.color }} />{g.name}</span>
            <span className="tr"><i style={{ width: `${(v!.d / v!.p) * 100}%` }} /></span>
            <em>{v!.d}/{v!.p}</em>
          </div>
        )) : <p className="hint">Group breakdown appears once tasks are planned.</p>}
      </div>
      <p className="hint">Completion counts days up to today. Future tasks are planned, not missed. Moving a task to tomorrow is not a miss.</p>
    </>
  )
  return wide ? (
    <div className="stats wide"><div>{head}{chart}</div><div>{side}</div></div>
  ) : (
    <div className="stats">{head}{chart}{side}</div>
  )
}

/* ---------------- Groups ---------------- */

export function GroupsManager({ ctx }: { ctx: Ctx }) {
  const { data, today } = ctx
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState('')
  const selected = data.groups.find((g) => g.id === sel)
  return (
    <div className="groups">
      {data.groups.map((g, i) => {
        const list = data.tasks.filter((t) => t.group_id === g.id && t.date >= today)
        const open = list.filter((t) => !t.done).length
        return (
          <div key={g.id} className={`grow${sel === g.id ? ' sel' : ''}`}>
            <button type="button" className="gd" style={{ background: g.color }} aria-label={`Change colour of ${g.name}`} onClick={() => setSel(sel === g.id ? null : g.id)} />
            {editing === g.id ? (
              <input className="gname" autoFocus defaultValue={g.name} aria-label="Group name"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) data.updateGroup(g.id, { name: v }); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
            ) : (
              <button type="button" className="gname" onClick={() => setEditing(g.id)} title="Rename">{g.name}</button>
            )}
            <span className="gact">
              <button type="button" aria-label={`Move ${g.name} up`} disabled={i === 0} onClick={() => data.moveGroup(g.id, -1)}>↑</button>
              <button type="button" aria-label={`Move ${g.name} down`} disabled={i === data.groups.length - 1} onClick={() => data.moveGroup(g.id, 1)}>↓</button>
              {confirm === g.id ? (
                <button type="button" className="danger" onClick={() => { data.deleteGroup(g.id); setConfirm(null) }}>Delete?</button>
              ) : (
                <button type="button" aria-label={`Delete ${g.name}`} onClick={() => setConfirm(g.id)}>×</button>
              )}
            </span>
            <small>{open} open · {list.length} upcoming</small>
            <span className="pb"><i style={{ width: `${list.length ? ((list.length - open) / list.length) * 100 : 0}%`, background: g.color }} /></span>
          </div>
        )
      })}
      {confirm && <p className="hint">Deleting a group moves its tasks to Inbox.</p>}
      {selected && (
        <>
          <div className="sec">Colour for “{selected.name}”</div>
          <div className="sw">
            {PALETTE.map((c) => (
              <button type="button" key={c} style={{ background: c }} className={selected.color === c ? 'on' : ''}
                aria-label={`Colour ${c}`} onClick={() => data.updateGroup(selected.id, { color: c })} />
            ))}
          </div>
        </>
      )}
      <form className="add" onSubmit={(e) => {
        e.preventDefault()
        const v = name.trim()
        if (!v) return
        data.addGroup(v, PALETTE[data.groups.length % PALETTE.length])
        setName('')
      }}>
        <input id="newGroup" value={name} onChange={(e) => setName(e.target.value)} placeholder="New group" aria-label="New group name" />
        <button className="ink" type="submit">Add</button>
      </form>
      <p className="hint">Tap a name to rename, the dot to change its colour.</p>
    </div>
  )
}

/* ---------------- Settings ---------------- */

const RULES: [string, [keyof Settings, string, string][]][] = [
  ['Task reminders', [
    ['before_start', 'Before start', 'Uses each task’s reminder time (10 or 30 min)'],
    ['at_start', 'At start time', '“Starting now” with the time window'],
    ['nudge', 'If not done', 'One nudge, 30 min after the end time'],
  ]],
  ['Tasks without a time', [
    ['morning', 'Morning summary', 'Every day at 08:00'],
    ['evening', 'Evening check', 'Every day at 20:00'],
  ]],
  ['Recaps', [
    ['weekly', 'Weekly recap', 'Sunday at 19:00'],
    ['monthly', 'Monthly recap', '1st of the month at 09:00'],
  ]],
  ['Quiet hours', [
    ['quiet', 'Quiet hours', '22:00–07:00'],
    ['urgent_through', 'Let urgent tasks through', 'Only tasks marked urgent'],
  ]],
]

export function SettingsView({ ctx, showGroups = true }: { ctx: Ctx; showGroups?: boolean }) {
  const { data } = ctx
  const s = data.settings
  const [pushOn, setPushOn] = useState(false)
  const [pushMsg, setPushMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { currentSubscription().then((s) => setPushOn(Boolean(s))) }, [])
  const canPush = pushSupported() && pushConfigured() && !ctx.demo
  const ios = /iphone|ipad/i.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone
  const pushHelp = ctx.demo ? 'Not available in the demo.'
    : !pushSupported() ? (ios ? 'On iPhone, add Afternoon Light to your Home Screen first (Share → Add to Home Screen).' : 'This browser cannot receive push notifications.')
    : !pushConfigured() ? 'Push is not set up on the server yet (see README).'
    : pushOn ? 'Reminders arrive even when the app is closed.' : 'Turn on to get reminders when the app is closed.'
  return (
    <div className="settings">
      <div className="sec">This device</div>
      <div className="srow">
        <div><b>Push notifications</b><small>{pushMsg || pushHelp}</small></div>
        {canPush && <Switch on={pushOn} label="Push notifications on this device" onChange={async (v) => {
          if (busy) return
          setBusy(true); setPushMsg('')
          if (v) { const err = await enablePush(); if (err) setPushMsg(err); else setPushOn(true) }
          else { await disablePush(); setPushOn(false) }
          setBusy(false)
        }} />}
      </div>
      {s && RULES.map(([h, rows]) => (
        <div key={h}>
          <div className="sec">{h}</div>
          {rows.map(([k, b, sm]) => (
            <div className="srow" key={k}>
              <div><b>{b}</b><small>{sm}</small></div>
              <Switch on={s[k]} label={b} onChange={(v) => data.saveSettings({ [k]: v })} />
            </div>
          ))}
        </div>
      ))}
      {showGroups && (<><div className="sec">Groups</div><GroupsManager ctx={ctx} /></>)}
      <div className="sec">Appearance</div>
      <div className="srow">
        <div><b>Reduce transparency</b><small>Solid surfaces instead of frosted glass (this device)</small></div>
        <Switch on={ctx.rt} label="Reduce transparency" onChange={ctx.setRt} />
      </div>
      <div className="sec">Account</div>
      <div className="srow">
        <div><b>{ctx.email}</b><small><span className={`live${data.live && !data.pending ? ' on' : ''}`} />{syncLabel(ctx)}</small></div>
        <button type="button" className="soft" onClick={ctx.signOut}>{ctx.demo ? 'Leave demo' : 'Sign out'}</button>
      </div>
    </div>
  )
}

export const gcStyle = (color: string) => ({ ['--gc' as string]: color }) as CSSProperties
export { groupOf }
