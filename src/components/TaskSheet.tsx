import { useEffect, useRef, useState } from 'react'
import type { Ctx } from '../ctx'
import { PALETTE, type Draft, type Reminder, type Repeat } from '../types'
import { Switch } from './shared'
import { fmt, toMin, wdIndex } from '../lib/time'
import type { Task } from '../types'

const DURS = [15, 30, 45, 60, 120]
const REMS: [Reminder, string][] = [['start', 'At start'], ['10', '10 min before'], ['30', '30 min before'], ['none', 'None']]
const REPS: [Repeat, string][] = [['never', 'Never'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week'], ['custom', 'Pick days']]
const WDS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WD_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Add / edit task. A bottom sheet on phones, a centred dialog on wide screens. */
export function TaskSheet({ ctx, draft, onClose }: { ctx: Ctx; draft: Draft; onClose: () => void }) {
  const { data } = ctx
  const editing = Boolean(draft.id)
  const [title, setTitle] = useState(draft.title ?? '')
  const [group, setGroup] = useState<string | null>(draft.group_id !== undefined ? draft.group_id : data.groups[0]?.id ?? null)
  const [date, setDate] = useState(draft.date ?? ctx.today)
  const [start, setStart] = useState(draft.start_time ?? '')
  const [dur, setDur] = useState<number | null>(draft.duration_min ?? (draft.start_time ? 30 : null))
  const [custom, setCustom] = useState(dur !== null && !DURS.includes(dur))
  const [reminder, setReminder] = useState<Reminder>(draft.reminder ?? '10')
  const [repeat, setRepeat] = useState<Repeat>(draft.repeat ?? 'never')
  const [days, setDays] = useState<number>(draft.repeat_days ?? (1 << wdIndex(draft.date ?? ctx.today)))
  const wasRepeating = editing && Boolean(draft.series_id) && draft.repeat !== 'never'
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [urgent, setUrgent] = useState(draft.urgent ?? false)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.documentElement.classList.add('modal-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('modal-open')
    }
  }, [onClose])

  const save = () => {
    const t = title.trim()
    if (!t) {
      setErr('Give the task a title.')
      titleRef.current?.focus()
      return
    }
    if (repeat === 'custom' && !days) {
      setErr('Pick at least one day for the task to repeat on.')
      return
    }
    const values = {
      title: t, group_id: group, date,
      start_time: start || null,
      duration_min: start ? dur : null,
      reminder, repeat, notes, urgent,
      repeat_days: repeat === 'custom' ? days : null,
    }
    if (editing) data.saveTask(draft as Task, values)
    else data.addTask({ ...values, done: false, done_at: null, series_id: null, skipped: false })
    onClose()
  }

  return (
    <div className="sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal glass" role="dialog" aria-modal="true" aria-label={editing ? 'Edit task' : 'New task'}
        onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="handle" />
        <div className="mh">
          <b>{editing ? 'Edit task' : 'New task'}</b>
          <button type="button" className="text" onClick={onClose}>Cancel</button>
        </div>
        <input ref={titleRef} id="taskTitle" className="big-in" value={title} onChange={(e) => { setTitle(e.target.value); setErr('') }}
          placeholder="What needs doing?" aria-label="Task title" aria-invalid={Boolean(err)} />
        {err && <p className="err">{err}</p>}

        <div>
          <div className="flab">Group</div>
          <div className="chips">
            {data.groups.map((g) => (
              <button type="button" key={g.id} className={`chip${group === g.id ? ' on' : ''}`} onClick={() => setGroup(g.id)}>
                <i style={{ background: g.color }} />{g.name}
              </button>
            ))}
            <button type="button" className={`chip${group === null ? ' on' : ''}`} onClick={() => setGroup(null)}>Inbox</button>
            {newGroup === null ? (
              <button type="button" className="chip new" onClick={() => setNewGroup('')}>+ New group</button>
            ) : (
              <span className="chip new-in">
                <input autoFocus id="sheetNewGroup" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name" aria-label="New group name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const v = newGroup.trim()
                      if (v) setGroup(data.addGroup(v, PALETTE[data.groups.length % PALETTE.length]).id)
                      setNewGroup(null)
                    }
                  }} />
              </span>
            )}
          </div>
        </div>

        <div className="two">
          <label className="fld"><small>Date</small><input id="taskDate" type="date" value={date} required onChange={(e) => setDate(e.target.value)} /></label>
          <label className="fld"><small>Start {start && <button type="button" className="text tiny" onClick={() => setStart('')}>No time</button>}</small>
            <input id="taskStart" type="time" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value && dur === null) setDur(30) }} />
          </label>
        </div>

        {start && (
          <div>
            <div className="flab">Duration {dur && <em>Ends {fmt(toMin(start) + dur)}</em>}</div>
            <div className="chips">
              {DURS.map((d) => (
                <button type="button" key={d} className={`chip${!custom && dur === d ? ' on' : ''}`} onClick={() => { setCustom(false); setDur(d) }}>
                  {d < 60 ? `${d}m` : `${d / 60}h`}
                </button>
              ))}
              <button type="button" className={`chip${custom ? ' on' : ''}`} onClick={() => setCustom(true)}>Custom</button>
              {custom && (
                <span className="chip new-in">
                  <input id="taskDur" type="number" min={1} max={1440} value={dur ?? ''} aria-label="Duration in minutes"
                    onChange={(e) => setDur(e.target.value ? Math.max(1, Math.min(1440, Number(e.target.value))) : null)} /> min
                </span>
              )}
            </div>
          </div>
        )}

        {start && (
          <div>
            <div className="flab">Remind me</div>
            <div className="chips">
              {REMS.map(([v, l]) => <button type="button" key={v} className={`chip${reminder === v ? ' on' : ''}`} onClick={() => setReminder(v)}>{l}</button>)}
            </div>
          </div>
        )}

        <div>
          <div className="flab">Repeat</div>
          <div className="chips">
            {REPS.map(([v, l]) => <button type="button" key={v} className={`chip${repeat === v ? ' on' : ''}`} aria-pressed={repeat === v} onClick={() => setRepeat(v)}>{l}</button>)}
          </div>
          {repeat === 'custom' && (
            <div className="wdpick" role="group" aria-label="Repeat on">
              {WDS.map((w, i) => (
                <button type="button" key={i} className={days & (1 << i) ? 'on' : ''} aria-pressed={Boolean(days & (1 << i))} aria-label={WD_NAMES[i]}
                  onClick={() => setDays(days ^ (1 << i))}>{w}</button>
              ))}
            </div>
          )}
          {repeat !== 'never' && <p className="hint">{wasRepeating ? 'Changes apply to this day and the days after it.' : 'A new task appears on each of these days, done or not.'}</p>}
        </div>

        <label className="fld"><small>Notes</small><textarea id="taskNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes" /></label>
        <div className="srow"><div><b>Urgent</b><small>Can break through quiet hours</small></div><Switch on={urgent} onChange={setUrgent} label="Urgent" /></div>

        <div className="mfoot">
          {editing && (confirmDel ? (
            wasRepeating ? (
              <span className="delopts">
                <button type="button" className="soft" onClick={() => { data.skipTask(draft as Task); onClose() }}>Skip this day</button>
                <button type="button" className="soft danger" onClick={() => { data.stopSeries(draft as Task); onClose() }}>Stop repeating</button>
              </span>
            ) : (
              <button type="button" className="soft danger" onClick={() => { data.deleteTask(draft.id!); onClose() }}>Delete task?</button>
            )
          ) : (
            <button type="button" className="text" onClick={() => setConfirmDel(true)}>Delete</button>
          ))}
          <button type="submit" className="ink grow1">Save task</button>
        </div>
      </form>
    </div>
  )
}
