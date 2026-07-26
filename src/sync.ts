/**
 * Offline-first sync engine.
 *
 * Local Dexie stays the working store. Every mutation is queued in the outbox
 * (see db.ts). This module pushes queued rows to Supabase as opaque AES-GCM
 * blobs encrypted with the vault DEK, and pulls remote changes incrementally
 * using the server-side updated_at cursor. Numeric local ids never leave the
 * device: rows reference each other by uuid inside the encrypted payload.
 *
 * Conflict policy: last-write-wins on the client-side modifiedAt timestamp
 * carried inside the encrypted payload.
 */
import { supabase } from './supabaseClient'
import {
  db, localDate, queueChange,
  type DailyTask, type Deadline, type Milestone, type OutboxEntry,
  type Subactivity, type SyncedCollection, type Task, type TimeSession,
} from './db'
import { decryptLocal, encryptLocal } from './localCrypto'
import { decryptWithVault, encryptWithVault, isVaultUnlocked } from './vault'

export const SYNC_EVENT = 'daybook-sync-state'
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'locked' | 'error'

let phase: SyncPhase = 'idle'
let lastError = ''
export function syncPhase() { return { phase, lastError } }

function setPhase(next: SyncPhase, error = '') {
  phase = next
  lastError = error
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_EVENT))
}

/* ------------------------------------------------------------------ */
/* Serialization: local row -> plaintext JSON (uuid references only)   */
/* ------------------------------------------------------------------ */

interface CloudRecord {
  id: string
  user_id?: string
  collection: SyncedCollection
  payload: string
  deleted: boolean
  updated_at?: string
}

async function uuidOfTask(taskId: number) {
  return (await db.tasks.get(taskId))?.uuid
}
async function uuidOfMilestone(milestoneId: number) {
  return (await db.milestones.get(milestoneId))?.uuid
}

async function serializeRow(collection: SyncedCollection, uuid: string): Promise<Record<string, unknown> | undefined> {
  switch (collection) {
    case 'task': {
      const row = await db.tasks.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return {
        uuid, createdAt: row.createdAt, createdOn: row.createdOn, modifiedAt: row.modifiedAt,
        text: await decryptLocal(row.text), notes: await decryptLocal(row.notes),
      }
    }
    case 'dailyTask': {
      const row = await db.dailyTasks.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return {
        uuid, taskUuid: await uuidOfTask(row.taskId), date: row.date, completed: row.completed,
        completedAt: row.completedAt, priority: row.priority, position: row.position,
        modifiedAt: row.modifiedAt, notes: await decryptLocal(row.notes),
      }
    }
    case 'timeSession': {
      const row = await db.timeSessions.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return { uuid, taskUuid: await uuidOfTask(row.taskId), startedAt: row.startedAt, endedAt: row.endedAt, modifiedAt: row.modifiedAt }
    }
    case 'milestone': {
      const row = await db.milestones.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return {
        uuid, progress: row.progress, position: row.position, createdAt: row.createdAt,
        updatedAt: row.updatedAt, dateLabel: row.dateLabel, status: row.status,
        startDate: row.startDate, endDate: row.endDate, modifiedAt: row.modifiedAt,
        title: await decryptLocal(row.title), notes: await decryptLocal(row.notes),
      }
    }
    case 'subactivity': {
      const row = await db.subactivities.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return {
        uuid, milestoneUuid: await uuidOfMilestone(row.milestoneId), completed: row.completed,
        position: row.position, createdAt: row.createdAt, modifiedAt: row.modifiedAt,
        title: await decryptLocal(row.title),
      }
    }
    case 'deadline': {
      const row = await db.deadlines.where('uuid').equals(uuid).first()
      if (!row) return undefined
      return {
        uuid, category: row.category, kind: row.kind, date: row.date,
        createdAt: row.createdAt, updatedAt: row.updatedAt, modifiedAt: row.modifiedAt,
        name: await decryptLocal(row.name), location: await decryptLocal(row.location),
        presentationFormat: await decryptLocal(row.presentationFormat),
        fee: await decryptLocal(row.fee), source: await decryptLocal(row.source),
      }
    }
    case 'appMeta': {
      const row = await db.appMeta.get(uuid)
      if (!row) return undefined
      return { key: row.key, value: row.value, modifiedAt: new Date().toISOString() }
    }
  }
}

/** appMeta keys use a deterministic record id derived from the key. */
async function recordIdFor(collection: SyncedCollection, uuid: string): Promise<string> {
  if (collection !== 'appMeta') return uuid
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`daybook-meta:${uuid}`))
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

async function pushOutbox(userId: string) {
  const entries = await db.outbox.orderBy('queuedAt').toArray()
  if (!entries.length) return
  const records: CloudRecord[] = []
  const processed: number[] = []

  for (const entry of entries) {
    const record = await buildRecord(userId, entry)
    if (record) records.push(record)
    processed.push(entry.id!)
  }

  for (let start = 0; start < records.length; start += 100) {
    const chunk = records.slice(start, start + 100)
    const { error } = await supabase!.from('records').upsert(chunk, { onConflict: 'user_id,id' })
    if (error) throw new Error(`push: ${error.message}`)
  }
  await db.outbox.bulkDelete(processed)
}

async function buildRecord(userId: string, entry: OutboxEntry): Promise<CloudRecord | undefined> {
  const id = await recordIdFor(entry.collection, entry.uuid)
  if (entry.op === 'delete') {
    return {
      id, user_id: userId, collection: entry.collection, deleted: true,
      payload: await encryptWithVault(JSON.stringify({ uuid: entry.uuid, deleted: true, modifiedAt: entry.queuedAt })),
    }
  }
  const plain = await serializeRow(entry.collection, entry.uuid)
  if (!plain) {
    // Row vanished locally between queueing and pushing: propagate a delete.
    return {
      id, user_id: userId, collection: entry.collection, deleted: true,
      payload: await encryptWithVault(JSON.stringify({ uuid: entry.uuid, deleted: true, modifiedAt: entry.queuedAt })),
    }
  }
  return {
    id, user_id: userId, collection: entry.collection, deleted: false,
    payload: await encryptWithVault(JSON.stringify(plain)),
  }
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

const CURSOR_KEY = 'sync.cursor'

async function pullChanges() {
  let cursor = (await db.appMeta.get(CURSOR_KEY))?.value ?? '1970-01-01T00:00:00Z'
  for (;;) {
    const { data, error } = await supabase!
      .from('records')
      .select('id, collection, payload, deleted, updated_at')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(500)
    if (error) throw new Error(`pull: ${error.message}`)
    if (!data?.length) break

    for (const record of data as CloudRecord[]) {
      await applyRecord(record)
      cursor = record.updated_at!
    }
    await db.appMeta.put({ key: CURSOR_KEY, value: cursor })
    if (data.length < 500) break
  }
  await retryPendingRows()
  if (!(await db.appMeta.get('initialPullDone'))) {
    await db.appMeta.put({ key: 'initialPullDone', value: new Date().toISOString() })
  }
}

interface PulledPayload {
  uuid?: string
  key?: string
  value?: string
  deleted?: boolean
  modifiedAt?: string
  taskUuid?: string
  milestoneUuid?: string
  [field: string]: unknown
}

async function applyRecord(record: CloudRecord) {
  let plain: PulledPayload
  try {
    plain = JSON.parse(await decryptWithVault(record.payload))
  } catch {
    return // ciphertext from a different vault generation — ignored
  }
  const collection = record.collection
  const uuid = plain.uuid ?? plain.key ?? ''
  if (!uuid) return

  const pending = await db.outbox.where('[collection+uuid]').equals([collection, uuid]).first()
  if (pending) {
    const local = await serializeRow(collection, uuid)
    const localStamp = (local?.modifiedAt as string | undefined) ?? pending.queuedAt
    const remoteStamp = plain.modifiedAt ?? record.updated_at ?? ''
    if (localStamp >= remoteStamp) return // local wins, will be pushed
    await db.outbox.delete(pending.id!)   // remote wins
  }

  if (record.deleted || plain.deleted) {
    await deleteLocalRow(collection, uuid)
    return
  }
  const applied = await upsertLocalRow(collection, plain)
  if (!applied) {
    await db.pendingRows.put({ collection, uuid, payload: JSON.stringify(plain), receivedAt: new Date().toISOString() })
  } else {
    await db.pendingRows.where('[collection+uuid]').equals([collection, uuid]).delete()
  }
}

async function deleteLocalRow(collection: SyncedCollection, uuid: string) {
  switch (collection) {
    case 'task': await db.tasks.where('uuid').equals(uuid).delete(); break
    case 'dailyTask': await db.dailyTasks.where('uuid').equals(uuid).delete(); break
    case 'timeSession': await db.timeSessions.where('uuid').equals(uuid).delete(); break
    case 'milestone': await db.milestones.where('uuid').equals(uuid).delete(); break
    case 'subactivity': await db.subactivities.where('uuid').equals(uuid).delete(); break
    case 'deadline': await db.deadlines.where('uuid').equals(uuid).delete(); break
    case 'appMeta': await db.appMeta.delete(uuid); break
  }
  await db.pendingRows.where('[collection+uuid]').equals([collection, uuid]).delete()
}

/** Returns false when a referenced parent row has not been pulled yet. */
async function upsertLocalRow(collection: SyncedCollection, plain: PulledPayload): Promise<boolean> {
  const uuid = plain.uuid ?? plain.key ?? ''
  switch (collection) {
    case 'task': {
      const row: Omit<Task, 'id'> = {
        uuid,
        text: await encryptLocal(String(plain.text ?? '')),
        notes: plain.notes !== undefined ? await encryptLocal(String(plain.notes)) : undefined,
        createdAt: String(plain.createdAt ?? new Date().toISOString()),
        createdOn: String(plain.createdOn ?? localDate()),
        modifiedAt: plain.modifiedAt,
      }
      const existing = await db.tasks.where('uuid').equals(uuid).first()
      if (existing) await db.tasks.update(existing.id!, row)
      else await db.tasks.add(row as Task)
      return true
    }
    case 'dailyTask': {
      const parent = plain.taskUuid ? await db.tasks.where('uuid').equals(plain.taskUuid).first() : undefined
      if (!parent) return false
      const row: Omit<DailyTask, 'id'> = {
        uuid,
        taskId: parent.id!,
        date: String(plain.date ?? localDate()),
        completed: Boolean(plain.completed),
        completedAt: plain.completedAt as string | undefined,
        priority: (plain.priority as DailyTask['priority']) ?? 'medium',
        position: Number(plain.position ?? 0),
        notes: plain.notes !== undefined ? await encryptLocal(String(plain.notes)) : '',
        modifiedAt: plain.modifiedAt,
      }
      const existing = await db.dailyTasks.where('uuid').equals(uuid).first()
      if (existing) { await db.dailyTasks.update(existing.id!, row); return true }
      // Unique [taskId+date] guard: two devices may have carried over the same
      // task independently. Converge deterministically on the smaller uuid.
      const clash = await db.dailyTasks.where('[taskId+date]').equals([parent.id!, row.date]).first()
      if (clash && clash.uuid !== uuid) {
        const keepPulled = uuid < (clash.uuid ?? '￿')
        if (keepPulled) {
          await db.dailyTasks.update(clash.id!, { ...row, completed: row.completed || clash.completed })
          if (clash.uuid) await queueChange('dailyTask', clash.uuid, 'delete')
        } else {
          if (clash.uuid) await queueChange('dailyTask', clash.uuid)
          await queueChange('dailyTask', uuid, 'delete')
        }
        return true
      }
      await db.dailyTasks.add(row as DailyTask)
      return true
    }
    case 'timeSession': {
      const parent = plain.taskUuid ? await db.tasks.where('uuid').equals(plain.taskUuid).first() : undefined
      if (!parent) return false
      const row: Omit<TimeSession, 'id'> = {
        uuid, taskId: parent.id!, startedAt: String(plain.startedAt ?? new Date().toISOString()),
        endedAt: plain.endedAt as string | undefined, modifiedAt: plain.modifiedAt,
      }
      const existing = await db.timeSessions.where('uuid').equals(uuid).first()
      if (existing) await db.timeSessions.update(existing.id!, row)
      else await db.timeSessions.add(row as TimeSession)
      return true
    }
    case 'milestone': {
      const row: Omit<Milestone, 'id'> = {
        uuid,
        title: await encryptLocal(String(plain.title ?? '')),
        notes: await encryptLocal(String(plain.notes ?? '')),
        progress: Number(plain.progress ?? 0),
        position: Number(plain.position ?? 0),
        createdAt: String(plain.createdAt ?? new Date().toISOString()),
        updatedAt: String(plain.updatedAt ?? new Date().toISOString()),
        dateLabel: String(plain.dateLabel ?? ''),
        status: (plain.status as Milestone['status']) ?? 'upcoming',
        startDate: String(plain.startDate ?? ''),
        endDate: String(plain.endDate ?? ''),
        modifiedAt: plain.modifiedAt,
      }
      const existing = await db.milestones.where('uuid').equals(uuid).first()
      if (existing) await db.milestones.update(existing.id!, row)
      else await db.milestones.add(row as Milestone)
      return true
    }
    case 'subactivity': {
      const parent = plain.milestoneUuid ? await db.milestones.where('uuid').equals(plain.milestoneUuid).first() : undefined
      if (!parent) return false
      const row: Omit<Subactivity, 'id'> = {
        uuid, milestoneId: parent.id!,
        title: await encryptLocal(String(plain.title ?? '')),
        completed: Boolean(plain.completed),
        position: Number(plain.position ?? 0),
        createdAt: String(plain.createdAt ?? new Date().toISOString()),
        modifiedAt: plain.modifiedAt,
      }
      const existing = await db.subactivities.where('uuid').equals(uuid).first()
      if (existing) await db.subactivities.update(existing.id!, row)
      else await db.subactivities.add(row as Subactivity)
      return true
    }
    case 'deadline': {
      const row: Omit<Deadline, 'id'> = {
        uuid,
        category: (plain.category as Deadline['category']) ?? 'conference',
        kind: String(plain.kind ?? ''),
        date: String(plain.date ?? ''),
        name: await encryptLocal(String(plain.name ?? '')),
        location: await encryptLocal(String(plain.location ?? '')),
        presentationFormat: await encryptLocal(String(plain.presentationFormat ?? '')),
        fee: await encryptLocal(String(plain.fee ?? '')),
        source: await encryptLocal(String(plain.source ?? '')),
        createdAt: String(plain.createdAt ?? new Date().toISOString()),
        updatedAt: String(plain.updatedAt ?? new Date().toISOString()),
        modifiedAt: plain.modifiedAt,
      }
      const existing = await db.deadlines.where('uuid').equals(uuid).first()
      if (existing) await db.deadlines.update(existing.id!, row)
      else await db.deadlines.add(row as Deadline)
      return true
    }
    case 'appMeta': {
      if (plain.key && !plain.key.startsWith('sync.') && plain.key !== 'cloudMode' && plain.key !== 'initialPullDone') {
        await db.appMeta.put({ key: plain.key, value: String(plain.value ?? '') })
      }
      return true
    }
  }
}

async function retryPendingRows() {
  for (let round = 0; round < 3; round += 1) {
    const rows = await db.pendingRows.toArray()
    if (!rows.length) return
    let progressed = false
    for (const row of rows) {
      const applied = await upsertLocalRow(row.collection, JSON.parse(row.payload))
      if (applied) {
        await db.pendingRows.delete(row.id!)
        progressed = true
      }
    }
    if (!progressed) return
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

let running = false
let timer: number | undefined
let debounce: number | undefined
let hookInstalled = false

export async function syncOnce(): Promise<void> {
  if (!supabase || running) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) { setPhase('offline'); return }
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) { setPhase('idle'); return }
  if (!(await isVaultUnlocked())) { setPhase('locked'); return }

  running = true
  setPhase('syncing')
  try {
    await pushOutbox(session.user.id)
    await pullChanges()
    await db.appMeta.put({ key: 'sync.lastSuccess', value: new Date().toISOString() })
    setPhase('idle')
    window.dispatchEvent(new Event('daybook-sync-done'))
  } catch (error) {
    setPhase('error', error instanceof Error ? error.message : String(error))
  } finally {
    running = false
  }
}

export function requestSync(delay = 1500) {
  if (typeof window === 'undefined') return
  window.clearTimeout(debounce)
  debounce = window.setTimeout(() => void syncOnce(), delay)
}

export function startSyncLoop() {
  if (!supabase || typeof window === 'undefined' || timer !== undefined) return
  timer = window.setInterval(() => void syncOnce(), 60_000)
  window.addEventListener('online', () => requestSync(0))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0)
  })
  if (!hookInstalled) {
    hookInstalled = true
    db.outbox.hook('creating', function () { requestSync() })
  }
  requestSync(0)
}

export function stopSyncLoop() {
  if (typeof window !== 'undefined' && timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}
