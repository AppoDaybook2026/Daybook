import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db, type Deadline } from './db'
import { decryptLocal } from './localCrypto'

const reminderHours = [9, 15, 21]

async function showReminder(event: Deadline) {
  const date = new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })
  const options: NotificationOptions = {
    body: `${event.name} · ${date}${event.location ? ` · ${event.location}` : ''}`,
    tag: `daybook-next-event-${event.id}`,
  }
  const registration = await navigator.serviceWorker?.ready
  if (registration) await registration.showNotification('Next Daybook event', options)
  else new Notification('Next Daybook event', options)
}

export function useDeadlineReminders() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const records = await db.deadlines.orderBy('date').toArray()
      return Promise.all(records.map(async (event) => ({
        ...event,
        name: await decryptLocal(event.name),
        location: await decryptLocal(event.location),
      })))
    }).subscribe({ next: setDeadlines, error: console.error })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const refresh = () => setPermission(Notification.permission)
    window.addEventListener('daybook-notification-permission', refresh)
    return () => window.removeEventListener('daybook-notification-permission', refresh)
  }, [])

  useEffect(() => {
    if (permission !== 'granted') return
    const upcoming = deadlines.find((event) => event.date >= new Date().toISOString().slice(0, 10))
    if (!upcoming) return

    const timers: number[] = []
    const schedule = (hour: number) => {
      const target = new Date()
      target.setHours(hour, 0, 0, 0)
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1)
      const delay = target.getTime() - Date.now()
      timers.push(window.setTimeout(() => {
        void showReminder(upcoming)
        schedule(hour)
      }, delay))
    }
    reminderHours.forEach(schedule)
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [deadlines, permission])
}
