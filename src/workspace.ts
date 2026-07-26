/**
 * Workspace-level operations: first-login import of the existing local
 * IndexedDB workspace, adoption of an existing cloud workspace on a new
 * device, and encrypted JSON backup / restore.
 */
import { db, newUuid, queueChange, type SyncedCollection } from './db'
import { decryptLocal, encryptLocal } from './localCrypto'
import { supabase } from './supabaseClient'
import { syncOnce } from './sync'
import { decryptJsonWithPassword, encryptJsonWithPassword, type PasswordEnvelope } from './vault'

export interface WorkspaceSummary {
  tasks: number
  dailyTasks: number
  milestones: number
  subactivities: number
  deadlines: number
  timeSessions: number
  total: number
}

export async function localWorkspaceSummary(): Promise<WorkspaceSummary> {
  const [tasks, dailyTasks, milestones, subactivities, deadlines, timeSessions] = await Promise.all([
    db.tasks.count(), db.dailyTasks.count(), db.milestones.count(),
    db.subactivities.count(), db.deadlines.count(), db.timeSessions.count(),
  ])
  return { tasks, dailyTasks, milestones, subactivities, deadlines, timeSessions, total: tasks + dailyTasks + milestones + subactivities + deadlines + timeSessions }
}

export async function cloudHasRecords(): Promise<boolean> {
  if (!supabase) return false
  const { count, error } = await supabase.from('records').select('id', { count: 'exact', head: true }).eq('deleted', false)
  if (error) throw new Error(error.message)
  return (count ?? 0) > 0
}

/** Queues every local row for upload — used to import the pre-existing local
 *  workspace into a freshly created encrypted account. */
export async function importLocalWorkspace() {
  const plan: Array<[SyncedCollection, { uuid?: string }[]]> = [
    ['task', await db.tasks.toArray()],
    ['milestone', await db.milestones.toArray()],
    ['deadline', await db.deadlines.toArray()],
    ['dailyTask', await db.dailyTasks.toArray()],
    ['subactivity', await db.subactivities.toArray()],
    ['timeSession', await db.timeSessions.toArray()],
  ]
  const seeded = await db.appMeta.get('dissertationTimelineSeeded')
  await db.transaction('rw', db.outbox, async () => {
    for (const [collection, rows] of plan) {
      for (const row of rows) if (row.uuid) await queueChange(collection, row.uuid)
    }
    if (seeded) await queueChange('appMeta', 'dissertationTimelineSeeded')
  })
  await syncOnce()
}

/** Replaces the local workspace with the account's cloud workspace. */
export async function adoptCloudWorkspace() {
  await db.transaction('rw', [db.tasks, db.dailyTasks, db.timeSessions, db.milestones, db.subactivities, db.deadlines, db.outbox, db.pendingRows, db.appMeta], async () => {
    await Promise.all([
      db.tasks.clear(), db.dailyTasks.clear(), db.timeSessions.clear(),
      db.milestones.clear(), db.subactivities.clear(), db.deadlines.clear(),
      db.outbox.clear(), db.pendingRows.clear(),
      db.appMeta.delete('sync.cursor'), db.appMeta.delete('initialPullDone'),
      db.appMeta.delete('dissertationTimelineSeeded'),
    ])
  })
  await syncOnce()
}

/* ------------------------------------------------------------------ */
/* Encrypted JSON backup                                               */
/* ------------------------------------------------------------------ */

interface BackupData {
  version: 1
  exportedAt: string
  tasks: Record<string, unknown>[]
  dailyTasks: Record<string, unknown>[]
  timeSessions: Record<string, unknown>[]
  milestones: Record<string, unknown>[]
  subactivities: Record<string, unknown>[]
  deadlines: Record<string, unknown>[]
}

async function decryptedRows(rows: Record<string, unknown>[], protectedFields: string[]): Promise<Record<string, unknown>[]> {
  return Promise.all(rows.map(async (row) => {
    const copy: Record<string, unknown> = { ...row }
    delete copy.id
    for (const field of protectedFields) {
      if (typeof copy[field] === 'string') copy[field] = await decryptLocal(copy[field] as string)
    }
    return copy
  }))
}

export async function exportEncryptedBackup(password: string): Promise<Blob> {
  const tasks = await db.tasks.toArray()
  const milestones = await db.milestones.toArray()
  const taskUuidById = new Map(tasks.map((task) => [task.id!, task.uuid]))
  const milestoneUuidById = new Map(milestones.map((milestone) => [milestone.id!, milestone.uuid]))
  const withTaskUuid = (rows: { taskId: number }[]) => rows.map((row) => {
    const copy: Record<string, unknown> = { ...row, taskUuid: taskUuidById.get(row.taskId) }
    delete copy.taskId
    return copy
  })
  const data: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: await decryptedRows(tasks as unknown as Record<string, unknown>[], ['text', 'notes']),
    dailyTasks: await decryptedRows(withTaskUuid(await db.dailyTasks.toArray()), ['notes']),
    timeSessions: await decryptedRows(withTaskUuid(await db.timeSessions.toArray()), []),
    milestones: await decryptedRows(milestones as unknown as Record<string, unknown>[], ['title', 'notes']),
    subactivities: await decryptedRows((await db.subactivities.toArray()).map((row) => {
      const copy: Record<string, unknown> = { ...row, milestoneUuid: milestoneUuidById.get(row.milestoneId) }
      delete copy.milestoneId
      return copy
    }), ['title']),
    deadlines: await decryptedRows(await db.deadlines.toArray() as unknown as Record<string, unknown>[], ['name', 'location', 'presentationFormat', 'fee', 'organizer', 'source']),
  }
  const envelope = await encryptJsonWithPassword(data, password)
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' })
}

export async function restoreEncryptedBackup(fileContent: string, password: string) {
  const envelope = JSON.parse(fileContent) as PasswordEnvelope
  if (envelope.daybookBackup !== 1) throw new Error('invalid-backup')
  const data = await decryptJsonWithPassword<BackupData>(envelope, password)
  if (data.version !== 1) throw new Error('invalid-backup')

  // Re-encrypt every protected field locally before writing, and rebuild
  // reference integrity through uuids.
  const preparedTasks: Record<string, unknown>[] = await Promise.all(data.tasks.map(async (row) => ({
    ...row,
    uuid: (row.uuid as string) ?? newUuid(),
    text: await encryptLocal(String(row.text ?? '')),
    notes: row.notes !== undefined ? await encryptLocal(String(row.notes)) : undefined,
  })))
  const preparedMilestones: Record<string, unknown>[] = await Promise.all(data.milestones.map(async (row) => ({
    ...row,
    uuid: (row.uuid as string) ?? newUuid(),
    title: await encryptLocal(String(row.title ?? '')),
    notes: await encryptLocal(String(row.notes ?? '')),
  })))
  const preparedDailyTasks: Record<string, unknown>[] = await Promise.all(data.dailyTasks.map(async (row) => ({
    ...row,
    uuid: (row.uuid as string) ?? newUuid(),
    notes: row.notes !== undefined ? await encryptLocal(String(row.notes)) : '',
  })))
  const preparedSubactivities: Record<string, unknown>[] = await Promise.all(data.subactivities.map(async (row) => ({
    ...row,
    uuid: (row.uuid as string) ?? newUuid(),
    title: await encryptLocal(String(row.title ?? '')),
  })))
  const preparedDeadlines: Record<string, unknown>[] = await Promise.all(data.deadlines.map(async (row) => ({
    ...row,
    uuid: (row.uuid as string) ?? newUuid(),
    name: await encryptLocal(String(row.name ?? '')),
    location: await encryptLocal(String(row.location ?? '')),
    presentationFormat: await encryptLocal(String(row.presentationFormat ?? '')),
    fee: await encryptLocal(String(row.fee ?? '')),
    organizer: await encryptLocal(String(row.organizer ?? '')),
    source: await encryptLocal(String(row.source ?? '')),
    // Sauvegardes anterieures a la v9 : valeurs par defaut.
    eventDate: String(row.eventDate ?? row.date ?? ''),
    eventType: row.eventType ?? 'conference',
    status: row.status ?? 'interested',
    priority: Number(row.priority ?? 0),
  })))

  await db.transaction('rw', [db.tasks, db.dailyTasks, db.timeSessions, db.milestones, db.subactivities, db.deadlines, db.outbox, db.pendingRows], async () => {
    await Promise.all([
      db.tasks.clear(), db.dailyTasks.clear(), db.timeSessions.clear(),
      db.milestones.clear(), db.subactivities.clear(), db.deadlines.clear(),
      db.outbox.clear(), db.pendingRows.clear(),
    ])

    const taskIdByUuid = new Map<string, number>()
    for (const row of preparedTasks) {
      const id = await db.tasks.add(row as never) as number
      taskIdByUuid.set(row.uuid as string, id)
      await queueChange('task', row.uuid as string)
    }
    const milestoneIdByUuid = new Map<string, number>()
    for (const row of preparedMilestones) {
      const id = await db.milestones.add(row as never) as number
      milestoneIdByUuid.set(row.uuid as string, id)
      await queueChange('milestone', row.uuid as string)
    }
    for (const row of preparedDailyTasks) {
      const taskId = taskIdByUuid.get(String(row.taskUuid ?? ''))
      if (taskId === undefined) continue
      const copy: Record<string, unknown> = { ...row, taskId }
      delete copy.taskUuid
      await db.dailyTasks.add(copy as never)
      await queueChange('dailyTask', row.uuid as string)
    }
    for (const row of data.timeSessions) {
      const uuid = (row.uuid as string) ?? newUuid()
      const taskId = taskIdByUuid.get(String(row.taskUuid ?? ''))
      if (taskId === undefined) continue
      const copy: Record<string, unknown> = { ...row, uuid, taskId }
      delete copy.taskUuid
      await db.timeSessions.add(copy as never)
      await queueChange('timeSession', uuid)
    }
    for (const row of preparedSubactivities) {
      const milestoneId = milestoneIdByUuid.get(String(row.milestoneUuid ?? ''))
      if (milestoneId === undefined) continue
      const copy: Record<string, unknown> = { ...row, milestoneId }
      delete copy.milestoneUuid
      await db.subactivities.add(copy as never)
      await queueChange('subactivity', row.uuid as string)
    }
    for (const row of preparedDeadlines) {
      await db.deadlines.add(row as never)
      await queueChange('deadline', row.uuid as string)
    }
  })
}
