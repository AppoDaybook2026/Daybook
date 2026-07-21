import Dexie, { type EntityTable } from 'dexie'
import { encryptLocal } from './localCrypto'

export interface Task {
  id?: number
  text: string
  createdAt: string
  createdOn: string
  notes?: string
}

export interface DailyTask {
  id?: number
  taskId: number
  date: string
  completed: boolean
  completedAt?: string
  priority: Priority
  position: number
  notes?: string
}

export type Priority = 'high' | 'medium' | 'low'

export interface TimeSession {
  id?: number
  taskId: number
  startedAt: string
  endedAt?: string
}

export interface Milestone {
  id?: number
  title: string
  progress: number
  notes: string
  position: number
  createdAt: string
  updatedAt: string
  dateLabel: string
  status: 'drafted' | 'on-track' | 'in-progress' | 'upcoming'
  startDate: string
  endDate: string
}

export interface Subactivity {
  id?: number
  milestoneId: number
  title: string
  completed: boolean
  position: number
  createdAt: string
}

export type DeadlineCategory = 'publication' | 'conference' | 'training'

export interface Deadline {
  id?: number
  category: DeadlineCategory
  kind: string
  name: string
  date: string
  location: string
  presentationFormat: string
  fee: string
  source: string
  createdAt: string
  updatedAt: string
}

interface AppMeta {
  key: string
  value: string
}

class DaybookDatabase extends Dexie {
  tasks!: EntityTable<Task, 'id'>
  dailyTasks!: EntityTable<DailyTask, 'id'>
  timeSessions!: EntityTable<TimeSession, 'id'>
  milestones!: EntityTable<Milestone, 'id'>
  appMeta!: EntityTable<AppMeta, 'key'>
  subactivities!: EntityTable<Subactivity, 'id'>
  deadlines!: EntityTable<Deadline, 'id'>

  constructor() {
    super('daybook')
    this.version(1).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed',
    })
    this.version(2).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
    }).upgrade(async (transaction) => {
      const entries = await transaction.table<DailyTask>('dailyTasks').toArray()
      await Promise.all(entries.map((entry, index) => transaction.table('dailyTasks').update(entry.id, {
        priority: 'medium',
        position: index,
      })))
    })
    this.version(3).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
      milestones: '++id, position, progress, updatedAt',
      appMeta: '&key',
    })
    this.version(4).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
      milestones: '++id, position, status, updatedAt',
      subactivities: '++id, milestoneId, completed, position',
      appMeta: '&key',
    })
    this.version(5).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
      milestones: '++id, position, status, updatedAt',
      subactivities: '++id, milestoneId, completed, position',
      appMeta: '&key',
    }).upgrade(async (transaction) => {
      const milestones = await transaction.table<Milestone>('milestones').orderBy('position').toArray()
      await Promise.all(milestones.map((milestone) => transaction.table('milestones').update(milestone.id, {
        startDate: milestone.position === 10 ? '2028-05' : milestone.position === 11 ? '2028-07' : '',
        endDate: milestone.position === 10 ? '2028-06' : milestone.position === 11 ? '2028-09' : '',
        dateLabel: '',
      })))
    })
    this.version(6).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
      milestones: '++id, position, status, updatedAt',
      subactivities: '++id, milestoneId, completed, position',
      appMeta: '&key',
    }).upgrade(async (transaction) => {
      const tasks = await transaction.table<Task>('tasks').toArray()
      const notesByTask = new Map(tasks.map((task) => [task.id, task.notes ?? '']))
      const entries = await transaction.table<DailyTask>('dailyTasks').toArray()
      await Promise.all(entries.map((entry) => transaction.table('dailyTasks').update(entry.id, {
        notes: notesByTask.get(entry.taskId) ?? '',
      })))
    })
    this.version(7).stores({
      tasks: '++id, createdOn, createdAt',
      dailyTasks: '++id, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, taskId, startedAt, endedAt',
      milestones: '++id, position, status, updatedAt',
      subactivities: '++id, milestoneId, completed, position',
      deadlines: '++id, category, date, updatedAt',
      appMeta: '&key',
    })
  }
}

export const db = new DaybookDatabase()

export function localDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000))
}

export async function prepareToday(date = localDate()) {
  const existing = await db.dailyTasks.where('date').equals(date).count()
  if (existing > 0) return

  const previousEntry = await db.dailyTasks.where('date').below(date).last()
  const previousDate = previousEntry?.date
  if (!previousDate) return

  const unfinished = await db.dailyTasks
    .where('date')
    .equals(previousDate)
    .filter((entry) => !entry.completed)
    .toArray()

  await db.transaction('rw', db.dailyTasks, async () => {
    await db.dailyTasks.bulkAdd(
      unfinished.map(({ taskId, priority, position, notes }) => ({
        taskId, date, completed: false, priority, position, notes: notes ?? '',
      })),
      { allKeys: true },
    )
  })
}

export async function addTask(text: string, date = localDate()) {
  const cleanText = text.trim()
  if (!cleanText) return
  const encryptedText = await encryptLocal(cleanText)

  await db.transaction('rw', db.tasks, db.dailyTasks, async () => {
    const taskId = (await db.tasks.add({
      text: encryptedText,
      createdAt: new Date().toISOString(),
      createdOn: date,
    })) as number
    const dayEntries = await db.dailyTasks.where('date').equals(date).toArray()
    const position = dayEntries.reduce((lowest, entry) => Math.min(lowest, entry.position), 0) - 1
    await db.dailyTasks.add({ taskId, date, completed: false, priority: 'medium', position, notes: '' })
  })
}

export async function setTaskCompleted(entryId: number, completed: boolean) {
  await db.transaction('rw', db.dailyTasks, db.timeSessions, async () => {
    const entry = await db.dailyTasks.get(entryId)
    await db.dailyTasks.update(entryId, {
      completed,
      completedAt: completed ? new Date().toISOString() : undefined,
    })
    if (completed && entry) await stopTimer(entry.taskId)
  })
}

export async function updateTaskText(taskId: number, text: string) {
  const cleanText = text.trim()
  if (cleanText) await db.tasks.update(taskId, { text: await encryptLocal(cleanText) })
}

export async function updateDailyTaskNotes(entryId: number, notes: string) {
  await db.dailyTasks.update(entryId, { notes: await encryptLocal(notes) })
}

export async function setTaskPriority(entryId: number, priority: Priority) {
  await db.dailyTasks.update(entryId, { priority })
}

export async function moveTask(entryId: number, direction: -1 | 1, date = localDate()) {
  await db.transaction('rw', db.dailyTasks, async () => {
    const entries = await db.dailyTasks.where('date').equals(date).sortBy('position')
    const index = entries.findIndex((entry) => entry.id === entryId)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= entries.length) return
    const current = entries[index]
    const adjacent = entries[swapIndex]
    await db.dailyTasks.update(current.id!, { position: adjacent.position })
    await db.dailyTasks.update(adjacent.id!, { position: current.position })
  })
}

export async function startTimer(taskId: number) {
  await db.transaction('rw', db.timeSessions, async () => {
    const active = await db.timeSessions.filter((session) => !session.endedAt).toArray()
    const endedAt = new Date().toISOString()
    await Promise.all(active.map((session) => db.timeSessions.update(session.id!, { endedAt })))
    await db.timeSessions.add({ taskId, startedAt: endedAt })
  })
}

export async function stopTimer(taskId: number) {
  const active = await db.timeSessions
    .where('taskId')
    .equals(taskId)
    .filter((session) => !session.endedAt)
    .toArray()
  const endedAt = new Date().toISOString()
  await Promise.all(active.map((session) => db.timeSessions.update(session.id!, { endedAt })))
}

const dissertationTimeline = [
  {
    title: 'Chapter 1 — Introduction and research problem',
    dateLabel: 'Février 2026', status: 'drafted' as const,
    subactivities: ['Context and rationale', 'Research problem', 'Objectives and research questions', 'Expected contribution of the study'],
  },
  {
    title: 'Chapter 2 — Literature review and conceptual framework',
    dateLabel: 'Mars – avril 2026', status: 'drafted' as const,
    subactivities: ['Structured literature search', 'Critical synthesis of prior work', 'Theoretical and conceptual framework', 'Literature gaps and propositions'],
  },
  {
    title: 'Chapter 3 — Methodology and research design',
    dateLabel: 'Mai 2026', status: 'drafted' as const,
    subactivities: ['Research design selection', 'Population, sample and field site', 'Variables and measurement strategy', 'Data analysis plan'],
  },
  {
    title: 'Data collection instruments',
    dateLabel: 'Juin – août 2026', status: 'on-track' as const,
    subactivities: ['First instrument draft', 'Expert validation', 'Pretest or pilot study', 'Revision and final version'],
  },
  {
    title: 'Secondary data assembly',
    dateLabel: 'En parallèle · 2026', status: 'in-progress' as const,
    subactivities: ['Identify secondary sources', 'Obtain access permissions', 'Compile and document the data', 'Check data quality'],
  },
  {
    title: 'Ethics approval — IRB',
    dateLabel: 'Septembre 2026', status: 'upcoming' as const,
    subactivities: ['Finalize the protocol', 'Prepare informed consent', 'Finalize the data management plan', 'Submit the IRB application'],
  },
  {
    title: 'Primary data collection and fieldwork',
    dateLabel: 'Octobre 2026 – mars 2027', status: 'upcoming' as const,
    subactivities: ['Prepare the fieldwork', 'Recruit participants', 'Conduct data collection', 'Close and secure the data'],
  },
  {
    title: 'Data analysis',
    dateLabel: 'Avril – septembre 2027', status: 'upcoming' as const,
    subactivities: ['Clean and prepare the data', 'Run the main analyses', 'Conduct robustness analyses', 'Interpret and synthesize results'],
  },
  {
    title: 'Chapter 4 — Presentation of results',
    dateLabel: 'Octobre 2027 – janvier 2028', status: 'upcoming' as const,
    subactivities: ['Structure the results', 'Produce tables and figures', 'Write the main findings', 'Review the chapter with supervisors'],
  },
  {
    title: 'Chapter 5 — Discussion and conclusion',
    dateLabel: 'Février – avril 2028', status: 'upcoming' as const,
    subactivities: ['Discuss findings against the literature', 'Present the contributions', 'Formulate limitations and recommendations', 'Write the general conclusion'],
  },
  {
    title: 'Full dissertation integration and revision',
    dateLabel: 'Mai – juin 2028', status: 'upcoming' as const,
    subactivities: ['Harmonize all chapters', 'Check references and appendices', 'Integrate committee feedback', 'Finalize the complete manuscript'],
  },
  {
    title: 'Dissertation defense preparation and defense',
    dateLabel: 'Juillet – septembre 2028', status: 'upcoming' as const,
    subactivities: ['Submit the manuscript', 'Prepare the presentation', 'Rehearse the defense', 'Defend and integrate final corrections'],
  },
]

export async function prepareMilestones() {
  await db.transaction('rw', db.milestones, db.subactivities, db.appMeta, async () => {
    if (await db.appMeta.get('dissertationTimelineSeeded')) return
    await db.subactivities.clear()
    await db.milestones.clear()
    const timestamp = new Date().toISOString()
    for (const [position, item] of dissertationTimeline.entries()) {
      const milestoneId = await db.milestones.add({
        title: item.title, dateLabel: item.dateLabel, status: item.status,
        startDate: position === 10 ? '2028-05' : position === 11 ? '2028-07' : '',
        endDate: position === 10 ? '2028-06' : position === 11 ? '2028-09' : '',
        progress: 0, notes: '', position, createdAt: timestamp, updatedAt: timestamp,
      }) as number
      await db.subactivities.bulkAdd(item.subactivities.map((title, subPosition) => ({
        milestoneId, title, completed: false, position: subPosition, createdAt: timestamp,
      })))
    }
    await db.appMeta.put({ key: 'dissertationTimelineSeeded', value: timestamp })
  })
}

export async function addMilestone(title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle) return
  const milestones = await db.milestones.toArray()
  const position = milestones.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
  const timestamp = new Date().toISOString()
  await db.milestones.add({
    title: await encryptLocal(cleanTitle),
    progress: 0,
    notes: '',
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
    dateLabel: 'Dates à définir',
    status: 'upcoming',
    startDate: '',
    endDate: '',
  })
}

export async function updateMilestone(id: number, changes: Partial<Pick<Milestone, 'title' | 'progress' | 'notes' | 'startDate' | 'endDate'>>) {
  const securedChanges = {
    ...changes,
    ...(changes.title !== undefined ? { title: await encryptLocal(changes.title.trim()) } : {}),
    ...(changes.notes !== undefined ? { notes: await encryptLocal(changes.notes) } : {}),
  }
  const normalized = {
    ...securedChanges,
    ...(changes.progress !== undefined ? { progress: Math.min(100, Math.max(0, Math.round(changes.progress))) } : {}),
    updatedAt: new Date().toISOString(),
  }
  if ('title' in normalized && !normalized.title) return
  await db.milestones.update(id, normalized)
}

export async function deleteMilestone(id: number) {
  await db.transaction('rw', db.milestones, db.subactivities, async () => {
    await db.subactivities.where('milestoneId').equals(id).delete()
    await db.milestones.delete(id)
  })
}

export async function addSubactivity(milestoneId: number, title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle) return
  const existing = await db.subactivities.where('milestoneId').equals(milestoneId).toArray()
  const position = existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
  await db.subactivities.add({
    milestoneId, title: await encryptLocal(cleanTitle), completed: false, position, createdAt: new Date().toISOString(),
  })
}

export async function addSubactivities(milestoneId: number, text: string) {
  const titles = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•●▪◦*-]\s*/, '').trim())
    .filter(Boolean)
  if (!titles.length) return 0
  const existing = await db.subactivities.where('milestoneId').equals(milestoneId).toArray()
  const firstPosition = existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
  const timestamp = new Date().toISOString()
  const encryptedTitles = await Promise.all(titles.map(encryptLocal))
  await db.subactivities.bulkAdd(encryptedTitles.map((title, index) => ({
    milestoneId, title, completed: false, position: firstPosition + index, createdAt: timestamp,
  })))
  return titles.length
}

export async function setSubactivityCompleted(id: number, completed: boolean) {
  await db.subactivities.update(id, { completed })
}

export async function updateSubactivity(id: number, title: string) {
  const cleanTitle = title.trim()
  if (cleanTitle) await db.subactivities.update(id, { title: await encryptLocal(cleanTitle) })
}

export async function deleteSubactivity(id: number) {
  await db.subactivities.delete(id)
}

export async function addDeadline(deadline: Omit<Deadline, 'id' | 'createdAt' | 'updatedAt'>) {
  const timestamp = new Date().toISOString()
  await db.deadlines.add({
    ...deadline,
    name: await encryptLocal(deadline.name.trim()),
    location: await encryptLocal(deadline.location),
    presentationFormat: await encryptLocal(deadline.presentationFormat),
    fee: await encryptLocal(deadline.fee),
    source: await encryptLocal(deadline.source),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function updateDeadline(id: number, changes: Partial<Omit<Deadline, 'id' | 'createdAt'>>) {
  const secure = { ...changes }
  if (changes.name !== undefined) secure.name = await encryptLocal(changes.name)
  if (changes.location !== undefined) secure.location = await encryptLocal(changes.location)
  if (changes.presentationFormat !== undefined) secure.presentationFormat = await encryptLocal(changes.presentationFormat)
  if (changes.fee !== undefined) secure.fee = await encryptLocal(changes.fee)
  if (changes.source !== undefined) secure.source = await encryptLocal(changes.source)
  await db.deadlines.update(id, { ...secure, updatedAt: new Date().toISOString() })
}

export async function deleteDeadline(id: number) {
  await db.deadlines.delete(id)
}
