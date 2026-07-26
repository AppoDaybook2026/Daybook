import { beforeEach, describe, expect, it } from 'vitest'
import {
  changePassphrase, createVault, decryptJsonWithPassword, decryptWithVault,
  encryptJsonWithPassword, encryptWithVault, isValidRecoveryPhrase, isVaultUnlocked,
  lockVault, unlockWithPassphrase, unlockWithRecoveryPhrase,
} from '../vault'

describe('vault end-to-end encryption', () => {
  beforeEach(async () => {
    await lockVault()
  })

  it('creates a vault, encrypts and decrypts a value (AES-GCM round trip)', async () => {
    const { envelope, recoveryPhrase } = await createVault('correct horse battery staple')
    expect(recoveryPhrase.split(' ')).toHaveLength(12)
    expect(isValidRecoveryPhrase(recoveryPhrase)).toBe(true)
    expect(envelope.wrapped_dek_passphrase.ct).not.toContain('correct horse')

    const ciphertext = await encryptWithVault('Rédiger le chapitre 2 — très privé')
    expect(ciphertext.startsWith('enc:v2:')).toBe(true)
    expect(ciphertext).not.toContain('chapitre')
    await expect(decryptWithVault(ciphertext)).resolves.toBe('Rédiger le chapitre 2 — très privé')
  })

  it('produces a unique IV per value (same plaintext -> different ciphertext)', async () => {
    await createVault('passphrase-123')
    const first = await encryptWithVault('same value')
    const second = await encryptWithVault('same value')
    expect(first).not.toBe(second)
  })

  it('unlocks with the passphrase on a new device and rejects a wrong one', async () => {
    const { envelope } = await createVault('my vault passphrase')
    const secret = await encryptWithVault('cross-device secret')
    await lockVault()
    expect(await isVaultUnlocked()).toBe(false)
    await expect(decryptWithVault(secret)).rejects.toThrow('vault-locked')

    await expect(unlockWithPassphrase(envelope, 'wrong passphrase')).rejects.toThrow()
    expect(await isVaultUnlocked()).toBe(false)

    await unlockWithPassphrase(envelope, 'my vault passphrase')
    await expect(decryptWithVault(secret)).resolves.toBe('cross-device secret')
  })

  it('unlocks with the 12-word recovery phrase (case/spacing tolerant)', async () => {
    const { envelope, recoveryPhrase } = await createVault('another passphrase')
    const secret = await encryptWithVault('recovered value')
    await lockVault()
    await unlockWithRecoveryPhrase(envelope, `  ${recoveryPhrase.toUpperCase()}  `)
    await expect(decryptWithVault(secret)).resolves.toBe('recovered value')
  })

  it('changes the passphrase without re-encrypting data', async () => {
    const { envelope } = await createVault('old passphrase')
    const secret = await encryptWithVault('stable data')
    const updated = await changePassphrase(envelope, { passphrase: 'old passphrase' }, 'new passphrase')
    await lockVault()
    await expect(unlockWithPassphrase(updated, 'old passphrase')).rejects.toThrow()
    await unlockWithPassphrase(updated, 'new passphrase')
    await expect(decryptWithVault(secret)).resolves.toBe('stable data')
  })

  it('password-protected backup envelope round trip, wrong password fails', async () => {
    const data = { tasks: [{ text: 'secret task' }], version: 1 }
    const envelope = await encryptJsonWithPassword(data, 'backup password')
    expect(JSON.stringify(envelope)).not.toContain('secret task')
    await expect(decryptJsonWithPassword(envelope, 'backup password')).resolves.toEqual(data)
    await expect(decryptJsonWithPassword(envelope, 'wrong')).rejects.toThrow()
  })
})
