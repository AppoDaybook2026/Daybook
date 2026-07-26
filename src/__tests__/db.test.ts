import { beforeEach, describe, expect, it } from 'vitest'
import { addTask, db, deleteDeadline, addDeadline, localDate, prepareToday, queueChange, setTaskCompleted } from '../db'
import { decryptLocal } from '../localCrypto'

async function reset() {
  await Promise.all([
    db.tasks.clear(), db.dailyTasks.clear(), db.timeSessions.clear(),
    db.milestones.clear(), db.subactivities.clear(), db.deadlines.clear(),
    db.outbox.clear(), db.pendingRows.clear(), db.appMeta.clear(),
  ])
}

describe('local store with sync outbox', () => {
  beforeEach(reset)

  it('encrypts task text at rest and queues sync changes with uuids', async () => {
    await addTask('Écrire la revue de littérature')
    const task = await db.tasks.toCollection().first()
    expect(task?.uuid).toBeTruthy()
    expect(task?.text.startsWith('enc:v1:')).toBe(true)
    await expect(decryptLocal(task!.text)).resolves.toBe('Écrire la revue de littérature')

    const queued = await db.outbox.toArray()
    expect(queued.map((entry) => entry.collection).sort()).toEqual(['dailyTask', 'task'])
    expect(queued.every((entry) => entry.op === 'upsert')).toBe(true)
  })

  it('deduplicates outbox entries per row', async () => {
    await queueChange('task', 'uuid-1')
    await queueChange('task', 'uuid-1')
    await queueChange('task', 'uuid-1', 'delete')
    const entries = await db.outbox.where('[collection+uuid]').equals(['task', 'uuid-1']).toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].op).toBe('delete')
  })

  it('carries over unfinished tasks to today with fresh uuids', async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d) })()
    await addTask('Tâche reportée', yesterday)
    const entry = await db.dailyTasks.toCollection().first()
    expect(entry?.date).toBe(yesterday)

    await prepareToday()
    const todayEntries = await db.dailyTasks.where('date').equals(localDate()).toArray()
    expect(todayEntries).toHaveLength(1)
    expect(todayEntries[0].uuid).not.toBe(entry!.uuid)
    expect(todayEntries[0].completed).toBe(false)
  })

  it('completing a task updates modifiedAt and queues the change', async () => {
    await addTask('À terminer')
    const entry = await db.dailyTasks.toCollection().first()
    await db.outbox.clear()
    await setTaskCompleted(entry!.id!, true)
    const updated = await db.dailyTasks.get(entry!.id!)
    expect(updated?.completed).toBe(true)
    const queued = await db.outbox.toArray()
    expect(queued.some((item) => item.collection === 'dailyTask' && item.uuid === entry!.uuid)).toBe(true)
  })

  it('deleting a deadline queues a tombstone', async () => {
    await addDeadline({
      category: 'conference', kind: 'presentation-submission', name: 'ICIS 2026',
      date: '2026-12-10', location: 'Lisbonne', presentationFormat: 'in-person', fee: '300 EUR', source: '',
    })
    const deadline = await db.deadlines.toCollection().first()
    expect(deadline?.name.startsWith('enc:v1:')).toBe(true)
    await db.outbox.clear()
    await deleteDeadline(deadline!.id!)
    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ collection: 'deadline', uuid: deadline!.uuid, op: 'delete' })
  })
})
