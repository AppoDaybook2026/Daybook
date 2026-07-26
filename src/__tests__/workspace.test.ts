import { beforeEach, describe, expect, it } from 'vitest'
import { addTask, db } from '../db'
import { decryptLocal } from '../localCrypto'
import { exportEncryptedBackup, restoreEncryptedBackup } from '../workspace'

describe('encrypted JSON backup', () => {
  beforeEach(async () => {
    await Promise.all([
      db.tasks.clear(), db.dailyTasks.clear(), db.timeSessions.clear(),
      db.milestones.clear(), db.subactivities.clear(), db.deadlines.clear(),
      db.outbox.clear(), db.pendingRows.clear(), db.appMeta.clear(),
    ])
  })

  it('exports an encrypted file and restores it losslessly', async () => {
    await addTask('Sauvegarde: tâche confidentielle')
    const blob = await exportEncryptedBackup('backup-pass-123')
    const raw = await blob.text()
    expect(raw).not.toContain('confidentielle')
    expect(JSON.parse(raw).daybookBackup).toBe(1)

    await db.tasks.clear()
    await db.dailyTasks.clear()
    await restoreEncryptedBackup(raw, 'backup-pass-123')

    const task = await db.tasks.toCollection().first()
    expect(task).toBeTruthy()
    await expect(decryptLocal(task!.text)).resolves.toBe('Sauvegarde: tâche confidentielle')
    const entry = await db.dailyTasks.toCollection().first()
    expect(entry?.taskId).toBe(task!.id)
    // Restored rows are queued for sync.
    expect(await db.outbox.count()).toBeGreaterThan(0)
  })

  it('rejects a wrong backup password', async () => {
    await addTask('X')
    const blob = await exportEncryptedBackup('right-password')
    await expect(restoreEncryptedBackup(await blob.text(), 'wrong-password')).rejects.toThrow()
  })
})
