import Dexie, { type EntityTable } from 'dexie'
import { encryptLocal } from './localCrypto'

export interface Task {
  id?: number
  uuid?: string
  text: string
  createdAt: string
  createdOn: string
  notes?: string
  modifiedAt?: string
}

export interface DailyTask {
  id?: number
  uuid?: string
  taskId: number
  date: string
  completed: boolean
  completedAt?: string
  priority: Priority
  position: number
  notes?: string
  modifiedAt?: string
}

export type Priority = 'high' | 'medium' | 'low'

export interface TimeSession {
  id?: number
  uuid?: string
  taskId: number
  startedAt: string
  endedAt?: string
  modifiedAt?: string
}

export interface Milestone {
  id?: number
  uuid?: string
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
  modifiedAt?: string
}

export interface Subactivity {
  id?: number
  uuid?: string
  milestoneId: number
  title: string
  completed: boolean
  position: number
  createdAt: string
  modifiedAt?: string
}

export type DeadlineCategory = 'publication' | 'conference' | 'training'

/** Nature de l'événement, indépendante de la catégorie de suivi. */
export type EventType =
  | 'conference' | 'workshop' | 'summer-school' | 'symposium'
  | 'seminar' | 'congress' | 'journal' | 'other'

export const EVENT_TYPES: EventType[] = [
  'conference', 'workshop', 'summer-school', 'symposium',
  'seminar', 'congress', 'journal', 'other',
]

/** Avancement de la candidature — la valeur ajoutée du suivi. */
export type SubmissionStatus =
  | 'interested' | 'planning' | 'drafting' | 'submitted'
  | 'accepted' | 'rejected' | 'presented'

export const SUBMISSION_STATUSES: SubmissionStatus[] = [
  'interested', 'planning', 'drafting', 'submitted',
  'accepted', 'rejected', 'presented',
]

/** Statuts qui ne demandent plus d'action : ils sortent du décompte à traiter. */
export const CLOSED_STATUSES: SubmissionStatus[] = ['accepted', 'rejected', 'presented']

export interface Deadline {
  id?: number
  uuid?: string
  category: DeadlineCategory
  kind: string
  name: string
  /** Date limite à respecter (soumission, inscription…). */
  date: string
  /** Date de l'événement lui-même, souvent postérieure à la date limite. */
  eventDate: string
  eventType: EventType
  location: string
  presentationFormat: string
  fee: string
  organizer: string
  source: string
  status: SubmissionStatus
  /** 1 à 5. 0 signifie « non classé ». */
  priority: number
  createdAt: string
  updatedAt: string
  modifiedAt?: string
}

export interface AppMeta {
  key: string
  value: string
}

export type SyncedCollection = 'task' | 'dailyTask' | 'timeSession' | 'milestone' | 'subactivity' | 'deadline' | 'appMeta'

export interface OutboxEntry {
  id?: number
  collection: SyncedCollection
  uuid: string
  op: 'upsert' | 'delete'
  queuedAt: string
}

/** Pulled records whose parent (task/milestone) has not arrived yet. */
export interface PendingRow {
  id?: number
  collection: SyncedCollection
  uuid: string
  payload: string
  receivedAt: string
}

class DaybookDatabase extends Dexie {
  tasks!: EntityTable<Task, 'id'>
  dailyTasks!: EntityTable<DailyTask, 'id'>
  timeSessions!: EntityTable<TimeSession, 'id'>
  milestones!: EntityTable<Milestone, 'id'>
  appMeta!: EntityTable<AppMeta, 'key'>
  subactivities!: EntityTable<Subactivity, 'id'>
  deadlines!: EntityTable<Deadline, 'id'>
  outbox!: EntityTable<OutboxEntry, 'id'>
  pendingRows!: EntityTable<PendingRow, 'id'>

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
    // v8 — multi-device sync support: stable uuids, outbox queue.
    this.version(8).stores({
      tasks: '++id, &uuid, createdOn, createdAt',
      dailyTasks: '++id, &uuid, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, &uuid, taskId, startedAt, endedAt',
      milestones: '++id, &uuid, position, status, updatedAt',
      subactivities: '++id, &uuid, milestoneId, completed, position',
      deadlines: '++id, &uuid, category, date, updatedAt',
      appMeta: '&key',
      outbox: '++id, [collection+uuid], queuedAt',
      pendingRows: '++id, &[collection+uuid], receivedAt',
    }).upgrade(async (transaction) => {
      const timestamp = new Date().toISOString()
      for (const tableName of ['tasks', 'dailyTasks', 'timeSessions', 'milestones', 'subactivities', 'deadlines']) {
        const rows = await transaction.table(tableName).toArray()
        await Promise.all(rows.map((row: { id: number; uuid?: string }) => transaction.table(tableName).update(row.id, {
          uuid: row.uuid ?? crypto.randomUUID(),
          modifiedAt: timestamp,
        })))
      }
    })

    // v9 : suivi de candidature. Migration purement additive — aucune donnée
    // existante n'est réécrite, seules des valeurs par défaut sont ajoutées.
    this.version(9).stores({
      tasks: '++id, &uuid, createdOn, createdAt',
      dailyTasks: '++id, &uuid, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, &uuid, taskId, startedAt, endedAt',
      milestones: '++id, &uuid, position, status, updatedAt',
      subactivities: '++id, &uuid, milestoneId, completed, position',
      deadlines: '++id, &uuid, category, date, eventDate, status, priority, updatedAt',
      appMeta: '&key',
      outbox: '++id, [collection+uuid], queuedAt',
      pendingRows: '++id, &[collection+uuid], receivedAt',
    }).upgrade(async (transaction) => {
      const rows = await transaction.table('deadlines').toArray()
      const emptyEncrypted = await encryptLocal('')
      await Promise.all(rows.map((row: Partial<Deadline> & { id: number }) =>
        transaction.table('deadlines').update(row.id, {
          // La date de l'événement était confondue avec la date limite :
          // on reprend celle-ci comme point de départ, l'utilisateur affinera.
          eventDate: row.eventDate ?? row.date ?? '',
          eventType: row.eventType ?? defaultEventType(row.category),
          organizer: row.organizer ?? emptyEncrypted,
          status: row.status ?? 'interested',
          priority: row.priority ?? 0,
          modifiedAt: new Date().toISOString(),
        })))
    })
  }
}

/** Type d'événement le plus plausible pour une catégorie donnée. */
function defaultEventType(category?: DeadlineCategory): EventType {
  if (category === 'publication') return 'journal'
  if (category === 'training') return 'workshop'
  return 'conference'
}

export const db = new DaybookDatabase()

export function newUuid() {
  return crypto.randomUUID()
}

/** Records a local mutation so the sync engine can push it later. */
export async function queueChange(collection: SyncedCollection, uuid: string, op: 'upsert' | 'delete' = 'upsert') {
  await db.outbox.where('[collection+uuid]').equals([collection, uuid]).delete()
  await db.outbox.add({ collection, uuid, op, queuedAt: new Date().toISOString() })
}

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

  await db.transaction('rw', db.dailyTasks, db.outbox, async () => {
    const timestamp = new Date().toISOString()
    const rows = unfinished.map(({ taskId, priority, position, notes }) => ({
      taskId, date, completed: false, priority, position, notes: notes ?? '',
      uuid: newUuid(), modifiedAt: timestamp,
    }))
    await db.dailyTasks.bulkAdd(rows, { allKeys: true })
    for (const row of rows) await queueChange('dailyTask', row.uuid)
  })
}

export async function addTask(text: string, date = localDate()) {
  const cleanText = text.trim()
  if (!cleanText) return
  const encryptedText = await encryptLocal(cleanText)

  await db.transaction('rw', db.tasks, db.dailyTasks, db.outbox, async () => {
    const timestamp = new Date().toISOString()
    const taskUuid = newUuid()
    const entryUuid = newUuid()
    const taskId = (await db.tasks.add({
      text: encryptedText,
      createdAt: timestamp,
      createdOn: date,
      uuid: taskUuid,
      modifiedAt: timestamp,
    })) as number
    const dayEntries = await db.dailyTasks.where('date').equals(date).toArray()
    const position = dayEntries.reduce((lowest, entry) => Math.min(lowest, entry.position), 0) - 1
    await db.dailyTasks.add({
      taskId, date, completed: false, priority: 'medium', position, notes: '',
      uuid: entryUuid, modifiedAt: timestamp,
    })
    await queueChange('task', taskUuid)
    await queueChange('dailyTask', entryUuid)
  })
}

async function touchDailyTask(entryId: number, changes: Partial<DailyTask>) {
  await db.transaction('rw', db.dailyTasks, db.outbox, async () => {
    const entry = await db.dailyTasks.get(entryId)
    if (!entry) return
    await db.dailyTasks.update(entryId, { ...changes, modifiedAt: new Date().toISOString() })
    if (entry.uuid) await queueChange('dailyTask', entry.uuid)
  })
}

export async function setTaskCompleted(entryId: number, completed: boolean) {
  const entry = await db.dailyTasks.get(entryId)
  await touchDailyTask(entryId, {
    completed,
    completedAt: completed ? new Date().toISOString() : undefined,
  })
  if (completed && entry) await stopTimer(entry.taskId)
}

export async function updateTaskText(taskId: number, text: string) {
  const cleanText = text.trim()
  if (!cleanText) return
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    const task = await db.tasks.get(taskId)
    if (!task) return
    await db.tasks.update(taskId, { text: await encryptLocal(cleanText), modifiedAt: new Date().toISOString() })
    if (task.uuid) await queueChange('task', task.uuid)
  })
}

export async function updateDailyTaskNotes(entryId: number, notes: string) {
  await touchDailyTask(entryId, { notes: await encryptLocal(notes) })
}

export async function setTaskPriority(entryId: number, priority: Priority) {
  await touchDailyTask(entryId, { priority })
}

export async function moveTask(entryId: number, direction: -1 | 1, date = localDate()) {
  await db.transaction('rw', db.dailyTasks, db.outbox, async () => {
    const entries = await db.dailyTasks.where('date').equals(date).sortBy('position')
    const index = entries.findIndex((entry) => entry.id === entryId)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= entries.length) return
    const current = entries[index]
    const adjacent = entries[swapIndex]
    const timestamp = new Date().toISOString()
    await db.dailyTasks.update(current.id!, { position: adjacent.position, modifiedAt: timestamp })
    await db.dailyTasks.update(adjacent.id!, { position: current.position, modifiedAt: timestamp })
    if (current.uuid) await queueChange('dailyTask', current.uuid)
    if (adjacent.uuid) await queueChange('dailyTask', adjacent.uuid)
  })
}

export async function startTimer(taskId: number) {
  await db.transaction('rw', db.timeSessions, db.outbox, async () => {
    const active = await db.timeSessions.filter((session) => !session.endedAt).toArray()
    const endedAt = new Date().toISOString()
    for (const session of active) {
      await db.timeSessions.update(session.id!, { endedAt, modifiedAt: endedAt })
      if (session.uuid) await queueChange('timeSession', session.uuid)
    }
    const uuid = newUuid()
    await db.timeSessions.add({ taskId, startedAt: endedAt, uuid, modifiedAt: endedAt })
    await queueChange('timeSession', uuid)
  })
}

export async function stopTimer(taskId: number) {
  await db.transaction('rw', db.timeSessions, db.outbox, async () => {
    const active = await db.timeSessions
      .where('taskId')
      .equals(taskId)
      .filter((session) => !session.endedAt)
      .toArray()
    const endedAt = new Date().toISOString()
    for (const session of active) {
      await db.timeSessions.update(session.id!, { endedAt, modifiedAt: endedAt })
      if (session.uuid) await queueChange('timeSession', session.uuid)
    }
  })
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
  // In cloud mode, wait for the first pull before seeding: the account may
  // already contain milestones from another device.
  const cloudMode = await db.appMeta.get('cloudMode')
  if (cloudMode?.value === 'on') {
    const pulled = await db.appMeta.get('initialPullDone')
    if (!pulled) return
    const existing = await db.milestones.count()
    if (existing > 0) return
  }
  await db.transaction('rw', db.milestones, db.subactivities, db.appMeta, db.outbox, async () => {
    if (await db.appMeta.get('dissertationTimelineSeeded')) return
    await db.subactivities.clear()
    await db.milestones.clear()
    const timestamp = new Date().toISOString()
    for (const [position, item] of dissertationTimeline.entries()) {
      const milestoneUuid = newUuid()
      const milestoneId = await db.milestones.add({
        title: item.title, dateLabel: item.dateLabel, status: item.status,
        startDate: position === 10 ? '2028-05' : position === 11 ? '2028-07' : '',
        endDate: position === 10 ? '2028-06' : position === 11 ? '2028-09' : '',
        progress: 0, notes: '', position, createdAt: timestamp, updatedAt: timestamp,
        uuid: milestoneUuid, modifiedAt: timestamp,
      }) as number
      await queueChange('milestone', milestoneUuid)
      const items = item.subactivities.map((title, subPosition) => ({
        milestoneId, title, completed: false, position: subPosition, createdAt: timestamp,
        uuid: newUuid(), modifiedAt: timestamp,
      }))
      await db.subactivities.bulkAdd(items)
      for (const sub of items) await queueChange('subactivity', sub.uuid)
    }
    await db.appMeta.put({ key: 'dissertationTimelineSeeded', value: timestamp })
    await queueChange('appMeta', 'dissertationTimelineSeeded')
  })
}

export async function addMilestone(title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle) return
  const milestones = await db.milestones.toArray()
  const position = milestones.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
  const timestamp = new Date().toISOString()
  const uuid = newUuid()
  const encryptedTitle = await encryptLocal(cleanTitle)
  await db.transaction('rw', db.milestones, db.outbox, async () => {
    await db.milestones.add({
      title: encryptedTitle,
      progress: 0,
      notes: '',
      position,
      createdAt: timestamp,
      updatedAt: timestamp,
      dateLabel: 'Dates à définir',
      status: 'upcoming',
      startDate: '',
      endDate: '',
      uuid,
      modifiedAt: timestamp,
    })
    await queueChange('milestone', uuid)
  })
}

export async function updateMilestone(id: number, changes: Partial<Pick<Milestone, 'title' | 'progress' | 'notes' | 'startDate' | 'endDate'>>) {
  const securedChanges = {
    ...changes,
    ...(changes.title !== undefined ? { title: await encryptLocal(changes.title.trim()) } : {}),
    ...(changes.notes !== undefined ? { notes: await encryptLocal(changes.notes) } : {}),
  }
  const timestamp = new Date().toISOString()
  const normalized = {
    ...securedChanges,
    ...(changes.progress !== undefined ? { progress: Math.min(100, Math.max(0, Math.round(changes.progress))) } : {}),
    updatedAt: timestamp,
    modifiedAt: timestamp,
  }
  if ('title' in normalized && !normalized.title) return
  await db.transaction('rw', db.milestones, db.outbox, async () => {
    const milestone = await db.milestones.get(id)
    if (!milestone) return
    await db.milestones.update(id, normalized)
    if (milestone.uuid) await queueChange('milestone', milestone.uuid)
  })
}

export async function deleteMilestone(id: number) {
  await db.transaction('rw', db.milestones, db.subactivities, db.outbox, async () => {
    const milestone = await db.milestones.get(id)
    const items = await db.subactivities.where('milestoneId').equals(id).toArray()
    await db.subactivities.where('milestoneId').equals(id).delete()
    await db.milestones.delete(id)
    for (const item of items) if (item.uuid) await queueChange('subactivity', item.uuid, 'delete')
    if (milestone?.uuid) await queueChange('milestone', milestone.uuid, 'delete')
  })
}

export async function addSubactivity(milestoneId: number, title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle) return
  const existing = await db.subactivities.where('milestoneId').equals(milestoneId).toArray()
  const position = existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
  const uuid = newUuid()
  const timestamp = new Date().toISOString()
  const encryptedTitle = await encryptLocal(cleanTitle)
  await db.transaction('rw', db.subactivities, db.outbox, async () => {
    await db.subactivities.add({
      milestoneId, title: encryptedTitle, completed: false, position,
      createdAt: timestamp, uuid, modifiedAt: timestamp,
    })
    await queueChange('subactivity', uuid)
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
  await db.transaction('rw', db.subactivities, db.outbox, async () => {
    const rows = encryptedTitles.map((title, index) => ({
      milestoneId, title, completed: false, position: firstPosition + index, createdAt: timestamp,
      uuid: newUuid(), modifiedAt: timestamp,
    }))
    await db.subactivities.bulkAdd(rows)
    for (const row of rows) await queueChange('subactivity', row.uuid)
  })
  return titles.length
}

export async function setSubactivityCompleted(id: number, completed: boolean) {
  await db.transaction('rw', db.subactivities, db.outbox, async () => {
    const item = await db.subactivities.get(id)
    if (!item) return
    await db.subactivities.update(id, { completed, modifiedAt: new Date().toISOString() })
    if (item.uuid) await queueChange('subactivity', item.uuid)
  })
}

export async function updateSubactivity(id: number, title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle) return
  const encryptedTitle = await encryptLocal(cleanTitle)
  await db.transaction('rw', db.subactivities, db.outbox, async () => {
    const item = await db.subactivities.get(id)
    if (!item) return
    await db.subactivities.update(id, { title: encryptedTitle, modifiedAt: new Date().toISOString() })
    if (item.uuid) await queueChange('subactivity', item.uuid)
  })
}

export async function deleteSubactivity(id: number) {
  await db.transaction('rw', db.subactivities, db.outbox, async () => {
    const item = await db.subactivities.get(id)
    await db.subactivities.delete(id)
    if (item?.uuid) await queueChange('subactivity', item.uuid, 'delete')
  })
}

export async function addDeadline(deadline: Omit<Deadline, 'id' | 'createdAt' | 'updatedAt'>) {
  const timestamp = new Date().toISOString()
  const uuid = newUuid()
  const row = {
    ...deadline,
    name: await encryptLocal(deadline.name.trim()),
    location: await encryptLocal(deadline.location),
    presentationFormat: await encryptLocal(deadline.presentationFormat),
    fee: await encryptLocal(deadline.fee),
    organizer: await encryptLocal(deadline.organizer ?? ''),
    source: await encryptLocal(deadline.source),
    eventDate: deadline.eventDate ?? '',
    eventType: deadline.eventType ?? defaultEventType(deadline.category),
    status: deadline.status ?? 'interested',
    priority: deadline.priority ?? 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    uuid,
    modifiedAt: timestamp,
  }
  await db.transaction('rw', db.deadlines, db.outbox, async () => {
    await db.deadlines.add(row)
    await queueChange('deadline', uuid)
  })
}

export async function updateDeadline(id: number, changes: Partial<Omit<Deadline, 'id' | 'createdAt'>>) {
  const secure = { ...changes }
  if (changes.name !== undefined) secure.name = await encryptLocal(changes.name)
  if (changes.location !== undefined) secure.location = await encryptLocal(changes.location)
  if (changes.presentationFormat !== undefined) secure.presentationFormat = await encryptLocal(changes.presentationFormat)
  if (changes.fee !== undefined) secure.fee = await encryptLocal(changes.fee)
  if (changes.organizer !== undefined) secure.organizer = await encryptLocal(changes.organizer)
  if (changes.source !== undefined) secure.source = await encryptLocal(changes.source)
  const timestamp = new Date().toISOString()
  await db.transaction('rw', db.deadlines, db.outbox, async () => {
    const deadline = await db.deadlines.get(id)
    if (!deadline) return
    await db.deadlines.update(id, { ...secure, updatedAt: timestamp, modifiedAt: timestamp })
    if (deadline.uuid) await queueChange('deadline', deadline.uuid)
  })
}

export async function deleteDeadline(id: number) {
  await db.transaction('rw', db.deadlines, db.outbox, async () => {
    const deadline = await db.deadlines.get(id)
    await db.deadlines.delete(id)
    if (deadline?.uuid) await queueChange('deadline', deadline.uuid, 'delete')
  })
}
