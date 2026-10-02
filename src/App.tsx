import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { clearCache, useData } from './lib/store'
import { useClock, useLocalFlag, useMedia } from './lib/hooks'
import { systemNotify, useReminders } from './lib/notify'
import { disablePush, pushEnabledHere, refreshPushTimezone } from './lib/push'
import { fmt, toMin } from './lib/time'
import { iso, nowMin, phaseOf } from './lib/time'
import type { Ctx } from './ctx'
import type { Draft } from './types'
import { LightField } from './components/shared'
import { TaskSheet } from './components/TaskSheet'
import { MobileApp } from './components/MobileApp'
import { DesktopApp } from './components/DesktopApp'

/** Light follows the real time of day; night switches to the dark palette. */
function useLight(now: Date, rt: boolean) {
  const phase = phaseOf(now.getHours())
  const reduce = useMedia('(prefers-reduced-transparency: reduce)')
  useEffect(() => {
    const r = document.documentElement
    r.classList.remove('t-morning', 't-afternoon', 't-evening', 't-night')
    r.classList.add(`t-${phase}`)
    r.classList.toggle('rt', rt || reduce)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', phase === 'night' ? '#1E1612' : '#F2E4D8')
  }, [phase, rt, reduce])
}

export default function App() {
  const now = useClock()
  const [rt, setRt] = useLocalFlag('al:rt', false)
  useLight(now, rt)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo'))

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <>
      <LightField />
      {demo ? <Main key="demo" userId="demo" email="Demo · saved in this browser" demo onExit={() => setDemo(false)} now={now} rt={rt} setRt={setRt} />
        : !configured ? <Setup onDemo={() => setDemo(true)} />
        : session === undefined ? <div className="center"><p className="hint">Loading…</p></div>
        : session ? <Main key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} now={now} rt={rt} setRt={setRt} />
        : <SignIn onDemo={() => setDemo(true)} />}
    </>
  )
}

interface MainProps { userId: string; email: string; demo?: boolean; onExit?: () => void; now: Date; rt: boolean; setRt: (v: boolean) => void }

function Main({ userId, email, demo = false, onExit, now, rt, setRt }: MainProps) {
  const data = useData(userId, demo)
  const wide = useMedia('(min-width: 900px)')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toast, setToast] = useState<{ title: string; body: string; taskId?: string } | null>(null)

  const push = useCallback((title: string, body: string, taskId?: string) => {
    setToast({ title, body, taskId })
    systemNotify(title, body, taskId)
  }, [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast])
  useReminders(data.tasks, data.settings, now, push)

  // Buttons on a push notification arrive as ?task=&action= (app was closed) or as a message (app was open).
  const [action, setAction] = useState<{ taskId: string; action: string } | null>(() => {
    const q = new URLSearchParams(location.search)
    const taskId = q.get('task')
    return taskId ? { taskId, action: q.get('action') ?? 'open' } : null
  })
  useEffect(() => {
    if (!navigator.serviceWorker) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'notification-action' && e.data.taskId) setAction({ taskId: e.data.taskId, action: e.data.action })
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])
  useEffect(() => {
    if (!action || !data.ready || demo) return
    const t = data.tasks.find((x) => x.id === action.taskId)
    setAction(null)
    history.replaceState(null, '', location.pathname)
    if (!t) return
    if (action.action === 'done') { if (!t.done) data.toggleDone(t) }
    else if (action.action === 'tomorrow') data.moveToTomorrow(t)
    else if (action.action === 'snooze' && t.start_time) data.updateTask(t.id, { start_time: fmt(Math.min(toMin(t.start_time) + 10, 1439)) })
    else setDraft(t)
  }, [action, data, demo])
  useEffect(() => { if (!demo && pushEnabledHere()) refreshPushTimezone() }, [demo])

  const ctx: Ctx = {
    data, now, today: iso(now), m: nowMin(now),
    open: setDraft, rt, setRt,
    email,
    demo,
    signOut: async () => {
      if (demo) return onExit?.()
      if (pushEnabledHere()) await disablePush().catch(() => {})
      clearCache(userId)
      supabase.auth.signOut()
    },
  }
  const close = useCallback(() => setDraft(null), [])

  if (!data.ready) return (
    <div className="center">
      {data.error ? <div className="card glass"><b>Couldn’t load</b><p>{data.error}</p></div> : <p className="hint">Syncing your tasks…</p>}
    </div>
  )
  return (
    <>
      {wide ? <DesktopApp ctx={ctx} toast={toast} /> : <MobileApp ctx={ctx} toast={toast} />}
      {draft && <TaskSheet key={draft.id ?? 'new'} ctx={ctx} draft={draft} onClose={close} />}
      {data.error && (
        <div className="errbar" role="alert">
          {data.error}
          <button type="button" className="text" onClick={data.clearError}>Dismiss</button>
        </div>
      )}
    </>
  )
}

function SignIn({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [err, setErr] = useState('')
  return (
    <div className="center">
      <form className="card glass" onSubmit={async (e) => {
        e.preventDefault()
        setState('sending')
        setErr('')
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
        if (error) { setErr(error.message); setState('idle') } else setState('sent')
      }}>
        <span className="appicon big" aria-hidden="true" />
        <h1>Afternoon Light</h1>
        {state === 'sent' ? (
          <p>We sent a sign-in link to <b>{email}</b>. Open it on this device to continue.</p>
        ) : (
          <>
            <p>Sign in with your email. Your tasks sync across your phone and computer.</p>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" autoComplete="email" />
            {err && <p className="err">{err}</p>}
            <button className="ink" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send sign-in link'}</button>
            <button type="button" className="text" onClick={onDemo}>Try the demo without an account</button>
          </>
        )}
      </form>
    </div>
  )
}

function Setup({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="center">
      <div className="card glass wide">
        <span className="appicon big" aria-hidden="true" />
        <h1>Connect Supabase</h1>
        <ol>
          <li>Create a project at supabase.com.</li>
          <li>Open SQL Editor and run <code>supabase/schema.sql</code>.</li>
          <li>In Authentication → URL Configuration, add <code>{window.location.origin}</code> as Site URL.</li>
          <li>Create <code>.env.local</code> in the project folder with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Project Settings → API).</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
        <button type="button" className="ink" onClick={onDemo}>Try the demo now</button>
        <p className="hint">The demo keeps sample tasks in this browser only. Nothing syncs until Supabase is connected.</p>
      </div>
    </div>
  )
}
