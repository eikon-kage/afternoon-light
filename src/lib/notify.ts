import { useEffect, useRef } from 'react'
import type { Settings, Task } from '../types'
import { iso, nowMin } from './time'
import { dueReminders, prevMonthDatesISO, recap, weekDatesISO } from '../../supabase/functions/_shared/rules'
import { pushEnabledHere } from './push'

export type Push = (title: string, body: string, taskId?: string) => void

const sent = new Set<string>()
function firstTime(key: string) {
  if (sent.has(key)) return false
  sent.add(key)
  try {
    if (localStorage.getItem('al:n:' + key)) return false
    localStorage.setItem('al:n:' + key, '1')
  } catch {
    /* storage unavailable: the in-memory set still prevents repeats in this tab */
  }
  return true
}

/** In-tab reminders, using the same rules as the push function (supabase/functions/_shared/rules.ts). */
export function useReminders(tasks: Task[], settings: Settings | null, now: Date, push: Push) {
  const pushRef = useRef(push)
  pushRef.current = push
  useEffect(() => {
    if (!settings) return
    const today = iso(now)
    const due = dueReminders({
      tasks, s: settings, today, m: nowMin(now), weekday: now.getDay(), dom: now.getDate(),
      recapWeek: () => recap(tasks, weekDatesISO(today), today),
      recapPrevMonth: () => recap(tasks, prevMonthDatesISO(today), today),
    })
    for (const d of due) if (firstTime(d.key)) pushRef.current(d.title, d.body, d.taskId)
  }, [tasks, settings, now])
}

/** System notification from the page, only when the tab is hidden and this device has no push (push already covers it). */
export function systemNotify(title: string, body: string, tag?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible' || pushEnabledHere()) return
  try {
    new Notification(title, { body, tag, icon: '/icon-192.png' })
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}
