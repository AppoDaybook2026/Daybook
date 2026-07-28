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

/**
 * Un jalon est soit un chapitre de la thèse, soit un moment clé du parcours
 * doctoral — approbation éthique, intégration finale, soutenance. Ces derniers
 * ne se numérotent pas et ne se lisent pas comme des chapitres.
 */
export type MilestoneKind = 'chapter' | 'moment'

export interface Milestone {
  id?: number
  uuid?: string
  title: string
  kind: MilestoneKind
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

    // v10 : distinction chapitre / moment clé du parcours doctoral.
    this.version(10).stores({
      tasks: '++id, &uuid, createdOn, createdAt',
      dailyTasks: '++id, &uuid, &[taskId+date], date, completed, priority, position',
      timeSessions: '++id, &uuid, taskId, startedAt, endedAt',
      milestones: '++id, &uuid, position, status, kind, updatedAt',
      subactivities: '++id, &uuid, milestoneId, completed, position',
      deadlines: '++id, &uuid, category, date, eventDate, status, priority, updatedAt',
      appMeta: '&key',
      outbox: '++id, [collection+uuid], queuedAt',
      pendingRows: '++id, &[collection+uuid], receivedAt',
    }).upgrade(async (transaction) => {
      const rows = await transaction.table('milestones').toArray()
      await Promise.all(rows.map((row: Partial<Milestone> & { id: number }) =>
        transaction.table('milestones').update(row.id, { kind: row.kind ?? 'chapter' })))
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

/**
 * Ossature par défaut : le plan d'une thèse en sciences de l'éducation,
 * entrecoupé des moments clés du parcours doctoral. Les « moments » ne sont
 * pas des chapitres : ils ne se numérotent pas et se placent là où ils
 * surviennent réellement — l'approbation éthique après la méthodologie,
 * l'intégration et la soutenance une fois le manuscrit complet.
 */
const thesisOutline: {
  title: string
  kind: MilestoneKind
  sections: string[]
}[] = [
  {
    title: 'I. Introduction',
    kind: 'chapter',
    sections: [
      '1.1 Hook and background on educational issue',
      '1.2 Statement of the problem',
      '1.3 Purpose of the study',
      '1.4 Research questions and objectives',
      '1.5 Significance for educational practice and policy',
      '1.6 Scope and delimitations',
      '1.7 Key terms and definitions',
    ],
  },
  {
    title: 'II. Review of the literature',
    kind: 'chapter',
    sections: [
      '2.1 Historical context and evolution of the topic',
      '2.2 Theoretical frameworks in education',
      '2.2.1 Learning theory or educational framework A',
      '2.2.2 Learning theory or educational framework B',
      '2.3 Current research on the main topic',
      '2.4 Influential studies and seminal works',
      '2.5 Gaps in the literature and unanswered questions',
      '2.6 Conceptual or analytical framework',
    ],
  },
  {
    title: 'III. Methodology',
    kind: 'chapter',
    sections: [
      '3.1 Research design',
      '3.2 Participants and educational setting',
      '3.3 Data collection methods',
      '3.3.1 Method 1 — surveys, interviews',
      '3.3.2 Method 2 — classroom observations',
      '3.4 Data analysis procedures',
      '3.5 Validity, reliability and credibility',
      '3.6 Ethical considerations in educational research',
    ],
  },
  {
    title: 'Ethics approval — IRB',
    kind: 'moment',
    sections: [
      'Finalize the protocol',
      'Prepare informed consent documents',
      'Finalize the data management plan',
      'Submit the IRB application',
      'Address reviewer comments',
    ],
  },
  {
    title: 'IV. Findings and results',
    kind: 'chapter',
    sections: [
      '4.1 Demographic and contextual information',
      '4.2 Findings related to research question 1',
      '4.3 Findings related to research question 2',
      '4.4 Findings related to research question 3',
      '4.5 Emergent themes or unexpected patterns',
    ],
  },
  {
    title: 'V. Discussion',
    kind: 'chapter',
    sections: [
      '5.1 Interpretation of findings in light of literature',
      '5.2 Alignment with and divergence from theoretical frameworks',
      '5.3 Limitations of the study',
      '5.4 Implications for educational practice',
      '5.5 Implications for educational policy',
      '5.6 Implications for teacher professional development',
      '5.7 Recommendations for future research',
    ],
  },
  {
    title: 'VI. Conclusion',
    kind: 'chapter',
    sections: [
      '6.1 Summary of key findings',
      '6.2 Contributions to the field of education',
      '6.3 Transformative potential and call to action',
    ],
  },
  {
    title: 'References',
    kind: 'chapter',
    sections: [
      'Compile and deduplicate the bibliography',
      'Check citation style consistency',
      'Verify every in-text citation has an entry',
    ],
  },
  {
    title: 'Appendices',
    kind: 'chapter',
    sections: [
      'Appendix A — survey instruments, interview protocols',
      'Appendix B — institutional review board approval',
      'Appendix C — coding schemes, rubrics',
    ],
  },
  {
    title: 'Full dissertation integration and revision',
    kind: 'moment',
    sections: [
      'Assemble all chapters into one manuscript',
      'Harmonize voice, terminology and formatting',
      'Supervisor review and revision cycle',
      'Language editing and proofreading',
      'Final formatting and plagiarism check',
    ],
  },
  {
    title: 'Dissertation defense preparation and defense',
    kind: 'moment',
    sections: [
      'Submit the manuscript to the jury',
      'Prepare the presentation',
      'Rehearse the defense',
      'Defend',
      'Integrate final corrections',
    ],
  },
]

/** Clé de version de l'ossature : la changer déclenche un remplacement. */
const OUTLINE_KEY = 'thesisOutline2026'

export async function prepareMilestones() {
  // En mode cloud, on attend la première synchronisation : le compte peut
  // déjà contenir des jalons venus d'un autre appareil, et les effacer avant
  // de les avoir vus produirait une perte silencieuse.
  const cloudMode = await db.appMeta.get('cloudMode')
  if (cloudMode?.value === 'on' && !(await db.appMeta.get('initialPullDone'))) return
  if (await db.appMeta.get(OUTLINE_KEY)) return

  // Le chiffrement passe par WebCrypto, étranger aux transactions Dexie.
  // L'attendre à l'intérieur ferait valider la transaction prématurément et
  // l'ossature ne serait posée qu'à moitié. On prépare donc tout avant.
  const emptyNotes = await encryptLocal('')
  const prepared = await Promise.all(thesisOutline.map(async (entry) => ({
    kind: entry.kind,
    title: await encryptLocal(entry.title),
    sections: await Promise.all(entry.sections.map((section) => encryptLocal(section))),
  })))

  await db.transaction('rw', db.milestones, db.subactivities, db.appMeta, db.outbox, async () => {
    if (await db.appMeta.get(OUTLINE_KEY)) return

    // Le remplacement doit se propager au cloud, sinon la synchronisation
    // suivante ramènerait l'ancienne ossature.
    const previousMilestones = await db.milestones.toArray()
    const previousSections = await db.subactivities.toArray()
    for (const milestone of previousMilestones) {
      if (milestone.uuid) await queueChange('milestone', milestone.uuid, 'delete')
    }
    for (const section of previousSections) {
      if (section.uuid) await queueChange('subactivity', section.uuid, 'delete')
    }
    await db.subactivities.clear()
    await db.milestones.clear()

    const timestamp = new Date().toISOString()
    for (const [position, entry] of prepared.entries()) {
      const milestoneUuid = newUuid()
      const milestoneId = await db.milestones.add({
        title: entry.title,
        kind: entry.kind,
        dateLabel: '',
        status: 'upcoming',
        startDate: '', endDate: '',
        progress: 0, notes: emptyNotes,
        position, createdAt: timestamp, updatedAt: timestamp,
        uuid: milestoneUuid, modifiedAt: timestamp,
      }) as number
      await queueChange('milestone', milestoneUuid)

      const sections = entry.sections.map((title, subPosition) => ({
        milestoneId,
        title,
        completed: false,
        position: subPosition,
        createdAt: timestamp,
        uuid: newUuid(),
        modifiedAt: timestamp,
      }))
      await db.subactivities.bulkAdd(sections)
      for (const section of sections) await queueChange('subactivity', section.uuid)
    }

    await db.appMeta.put({ key: OUTLINE_KEY, value: timestamp })
    await queueChange('appMeta', OUTLINE_KEY)
  })
}

/**
 * Déplace un jalon d'un cran. Les positions sont échangées avec le voisin,
 * ce qui évite de renuméroter toute la liste à chaque mouvement.
 */
export async function moveMilestone(id: number, direction: -1 | 1) {
  await db.transaction('rw', db.milestones, db.outbox, async () => {
    const ordered = await db.milestones.orderBy('position').toArray()
    const index = ordered.findIndex((milestone) => milestone.id === id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= ordered.length) return

    const current = ordered[index]
    const neighbour = ordered[target]
    const timestamp = new Date().toISOString()
    await db.milestones.update(current.id!, { position: neighbour.position, modifiedAt: timestamp, updatedAt: timestamp })
    await db.milestones.update(neighbour.id!, { position: current.position, modifiedAt: timestamp, updatedAt: timestamp })
    if (current.uuid) await queueChange('milestone', current.uuid)
    if (neighbour.uuid) await queueChange('milestone', neighbour.uuid)
  })
}

/**
 * Insère un jalon juste après celui indiqué, en décalant les suivants.
 * `afterId` à null insère en tête.
 */
export async function insertMilestone(afterId: number | null, title: string, kind: MilestoneKind = 'chapter') {
  const cleanTitle = title.trim()
  if (!cleanTitle) return

  // Chiffrement hors transaction : voir prepareMilestones.
  const encryptedTitle = await encryptLocal(cleanTitle)
  const encryptedNotes = await encryptLocal('')

  await db.transaction('rw', db.milestones, db.outbox, async () => {
    const ordered = await db.milestones.orderBy('position').toArray()
    const anchor = afterId === null ? -1 : ordered.findIndex((milestone) => milestone.id === afterId)
    const insertAt = anchor + 1
    const timestamp = new Date().toISOString()

    // On décale les suivants avant d'insérer, pour ne jamais avoir deux
    // jalons à la même position.
    for (let index = ordered.length - 1; index >= insertAt; index -= 1) {
      const milestone = ordered[index]
      await db.milestones.update(milestone.id!, { position: index + 1, modifiedAt: timestamp })
      if (milestone.uuid) await queueChange('milestone', milestone.uuid)
    }

    const uuid = newUuid()
    await db.milestones.add({
      title: encryptedTitle,
      kind,
      progress: 0,
      notes: encryptedNotes,
      position: insertAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      dateLabel: '',
      status: 'upcoming',
      startDate: '',
      endDate: '',
      uuid,
      modifiedAt: timestamp,
    })
    await queueChange('milestone', uuid)
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
      kind: 'chapter',
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
