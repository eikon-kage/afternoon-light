// Sends due reminders as Web Push. Called every minute by pg_cron (see supabase/cron.sql).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { DEFAULT_RULES, addDaysISO, dueReminders, missingOccurrences, prevMonthDatesISO, recap, weekDatesISO, type RSettings, type RTask } from '../_shared/rules.ts'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; tz: string }
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local date, minutes, weekday and day-of-month in `tz`. */
function localNow(tz: string) {
  let zone = tz
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }) } catch { zone = 'UTC' }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  return { today: `${p.year}-${p.month}-${p.day}`, m: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: WD.indexOf(p.weekday), dom: Number(p.day) }
}

const COLS = 'id,title,date,start_time,duration_min,reminder,urgent,done,skipped'
const norm = (t: RTask): RTask => ({ ...t, start_time: t.start_time ? String(t.start_time).slice(0, 5) : null })
async function tasksBetween(user: string, from: string, to: string) {
  const { data } = await db.from('tasks').select(COLS).eq('user_id', user).gte('date', from).lte('date', to)
  return ((data ?? []) as RTask[]).map(norm)
}

/**
 * Creates today's row for each repeating task, so reminders fire even if the user has not opened
 * the app since yesterday. The (user_id, series_id, date) constraint makes this safe to race with devices.
 */
async function makeTodaysRepeats(user: string, today: string) {
  const { data } = await db.from('tasks').select('*').eq('user_id', user).not('series_id', 'is', null).gte('date', addDaysISO(today, -62))
  const rows = (data ?? []) as (Record<string, unknown> & { id: string; series_id: string | null; date: string; repeat: string; repeat_days: number | null })[]
  const add = missingOccurrences(rows, [today]).map(({ template, date }) => {
    const { created_at: _c, updated_at: _u, ...rest } = template
    return { ...rest, id: crypto.randomUUID(), date, done: false, done_at: null, skipped: false }
  })
  if (add.length) await db.from('tasks').upsert(add, { onConflict: 'user_id,series_id,date', ignoreDuplicates: true })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('Forbidden', { status: 403 })

  const { data: subs, error } = await db.from('push_subscriptions').select('*')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const byUser = new Map<string, Sub[]>()
  for (const s of (subs ?? []) as Sub[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s])

  let sent = 0, removed = 0
  for (const [user, list] of byUser) {
    const t = localNow(list[0].tz)
    const { data: st } = await db.from('notification_settings').select('*').eq('user_id', user).maybeSingle()
    const s: RSettings = { ...DEFAULT_RULES, ...(st ?? {}) }
    await makeTodaysRepeats(user, t.today)
    const tasks = await tasksBetween(user, t.today, t.today)
    // Recaps need more than today's tasks; fetch those only on the days they can fire.
    const week = weekDatesISO(t.today)
    const month = prevMonthDatesISO(t.today)
    const weekTasks = s.weekly && t.weekday === 0 ? await tasksBetween(user, week[0], week[6]) : []
    const monthTasks = s.monthly && t.dom === 1 ? await tasksBetween(user, month[0], month[month.length - 1]) : []
    const due = dueReminders({
      tasks, s, ...t,
      recapWeek: () => recap(weekTasks, week, t.today),
      recapPrevMonth: () => recap(monthTasks, month, t.today),
    })

    for (const d of due) {
      // The log row is the lock: only the first run to insert it sends.
      const { data: claimed } = await db.from('notification_log').upsert({ user_id: user, key: d.key }, { onConflict: 'user_id,key', ignoreDuplicates: true }).select()
      if (!claimed?.length) continue
      const payload = JSON.stringify({ title: d.title, body: d.body, tag: d.key, taskId: d.taskId, actions: d.actions })
      for (const sub of list) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 600 })
          sent++
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) {
            await db.from('push_subscriptions').delete().eq('id', sub.id)
            removed++
          }
        }
      }
    }
  }
  await db.from('notification_log').delete().lt('sent_at', new Date(Date.now() - 3 * 86400000).toISOString())
  return Response.json({ users: byUser.size, sent, removed })
})
