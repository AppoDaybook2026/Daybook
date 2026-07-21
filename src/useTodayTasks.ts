import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db, localDate, prepareToday, type DailyTask, type Task, type TimeSession } from './db'
import demoData from './demo-data.json'
import { decryptLocal } from './localCrypto'

export type TodayTask = DailyTask & { task: Task; sessions: TimeSession[] }

const capturedTasks = demoData.tasks as Task[]
const capturedEntries = demoData.dailyTasks as DailyTask[]
const capturedSessions = demoData.timeSessions as TimeSession[]
const latestCapturedDate = capturedEntries.reduce((latest, entry) => entry.date > latest ? entry.date : latest, '')

function capturedTasksForDate(date: string) {
  const capturedDate = capturedEntries.some((entry) => entry.date === date) ? date : latestCapturedDate
  return capturedEntries.filter((entry) => entry.date === capturedDate).flatMap((entry) => {
    const task = capturedTasks.find((item) => item.id === entry.taskId)
    return task ? [{
      ...entry,
      task,
      sessions: capturedSessions.filter((session) => session.taskId === entry.taskId && localDate(new Date(session.startedAt)) === capturedDate),
    }] : []
  }).sort((a, b) => a.position - b.position) as TodayTask[]
}

export function useTodayTasks(demo = false, date = localDate()) {
  const [tasks, setTasks] = useState<TodayTask[]>(demo ? capturedTasksForDate(date) : [])
  const [loading, setLoading] = useState(!demo)

  useEffect(() => {
    if (demo) {
      setTasks(capturedTasksForDate(date))
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    if (date === localDate()) void prepareToday(date).catch(console.error)

    const subscription = liveQuery(async () => {
      const entries = await db.dailyTasks.where('date').equals(date).toArray()
      const records = await db.tasks.bulkGet(entries.map((entry) => entry.taskId))
      const sessions = await db.timeSessions.toArray()
      const readableEntries = await Promise.all(entries.map(async (entry) => ({ ...entry, notes: await decryptLocal(entry.notes) })))
      const readableRecords = await Promise.all(records.map(async (task) => task ? ({
        ...task,
        text: await decryptLocal(task.text),
        notes: await decryptLocal(task.notes),
      }) : undefined))
      return readableEntries.flatMap((entry, index) => {
        const task = readableRecords[index]
        return task ? [{
          ...entry,
          task,
          sessions: sessions.filter((session) => session.taskId === entry.taskId && localDate(new Date(session.startedAt)) === date),
        }] : []
      }).sort((a, b) => a.position - b.position)
    }).subscribe({
      next: (value) => {
        if (!active) return
        setTasks(value)
        setLoading(false)
      },
      error: (error) => {
        console.error(error)
        if (active) setLoading(false)
      },
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [date, demo])

  return { tasks, loading, date }
}
