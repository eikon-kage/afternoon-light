import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const FLAG = 'al:push'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushConfigured = () => Boolean(VAPID)
export const pushEnabledHere = () => {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}
const setFlag = (on: boolean) => {
  try { localStorage.setItem(FLAG, on ? '1' : '0') } catch { /* per-device hint only */ }
}

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Asks permission, subscribes this browser and stores the subscription for the send-reminders function. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return 'This browser cannot receive push notifications.'
  if (!VAPID) return 'Push is not configured: VITE_VAPID_PUBLIC_KEY is missing.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'Notifications are blocked for this site. Allow them in the browser settings.'
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }))
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { onConflict: 'endpoint' },
  )
  if (error) return `Could not save this device: ${error.message}`
  setFlag(true)
  return null
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  setFlag(false)
}

/** Keeps the stored time zone current (travel, DST changes in a new zone). */
export async function refreshPushTimezone() {
  const sub = await currentSubscription()
  if (!sub) { setFlag(false); return }
  setFlag(true)
  await supabase.from('push_subscriptions').update({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }).eq('endpoint', sub.endpoint)
}
