/**
 * Daybook vault — end-to-end encryption layer.
 *
 * A random 256-bit data-encryption key (DEK) encrypts every personal value with
 * AES-GCM and a unique 96-bit IV. The DEK itself never leaves the device in
 * clear form: the backend only ever stores the DEK wrapped (encrypted) by keys
 * derived from the vault passphrase and from the 12-word recovery phrase.
 * Neither phrase, nor any derived key, nor the raw DEK is ever transmitted.
 */
import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

export const CLOUD_PREFIX = 'enc:v2:'

export interface KdfParams {
  algo: 'argon2id' | 'pbkdf2'
  m?: number
  t?: number
  p?: number
  iter?: number
  hash?: string
}

export interface WrappedKey {
  v: 1
  kdf: KdfParams
  salt: string
  iv: string
  ct: string
}

export interface VaultEnvelope {
  wrapped_dek_passphrase: WrappedKey
  wrapped_dek_recovery: WrappedKey
}

const ARGON2: KdfParams = { algo: 'argon2id', m: 65536, t: 3, p: 1 }
const PBKDF2: KdfParams = { algo: 'pbkdf2', iter: 600_000, hash: 'SHA-256' }

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function deriveKek(secret: string, salt: Uint8Array, params: KdfParams): Promise<CryptoKey> {
  let raw: Uint8Array
  if (params.algo === 'argon2id') {
    const { argon2id } = await import('hash-wasm')
    raw = await argon2id({
      password: secret,
      salt,
      parallelism: params.p ?? 1,
      iterations: params.t ?? 3,
      memorySize: params.m ?? 65536,
      hashLength: 32,
      outputType: 'binary',
    })
  } else {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
    raw = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: params.iter ?? 600_000, hash: params.hash ?? 'SHA-256' },
      material,
      256,
    ))
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function preferredKdf(): Promise<KdfParams> {
  try {
    const { argon2id } = await import('hash-wasm')
    await argon2id({ password: 'probe', salt: new Uint8Array(16), parallelism: 1, iterations: 1, memorySize: 64, hashLength: 16, outputType: 'binary' })
    return { ...ARGON2 }
  } catch {
    return { ...PBKDF2 }
  }
}

async function wrapDek(rawDek: Uint8Array, secret: string, kdf: KdfParams): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const kek = await deriveKek(secret, salt, kdf)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, rawDek as BufferSource)
  return { v: 1, kdf, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

async function unwrapDek(wrapped: WrappedKey, secret: string): Promise<Uint8Array> {
  const kek = await deriveKek(secret, fromBase64(wrapped.salt), wrapped.kdf)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv) as BufferSource },
    kek,
    fromBase64(wrapped.ct) as BufferSource,
  )
  return new Uint8Array(raw)
}

/* ------------------------------------------------------------------ */
/* Non-extractable DEK cache (IndexedDB) so the app works offline      */
/* ------------------------------------------------------------------ */

function openVaultDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('daybook-vault', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('keys')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCachedDek(): Promise<CryptoKey | undefined> {
  const database = await openVaultDatabase()
  try {
    return await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = database.transaction('keys', 'readonly').objectStore('keys').get('dek')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

async function writeCachedDek(key: CryptoKey | undefined) {
  const database = await openVaultDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const store = database.transaction('keys', 'readwrite').objectStore('keys')
      const request = key ? store.put(key, 'dek') : store.delete('dek')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

let dekPromise: Promise<CryptoKey | undefined> | undefined

async function importDek(rawDek: Uint8Array): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', rawDek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  await writeCachedDek(key)
  dekPromise = Promise.resolve(key)
  notifyVaultChange()
  return key
}

export async function cachedDek(): Promise<CryptoKey | undefined> {
  if (!dekPromise) dekPromise = readCachedDek().catch(() => undefined)
  return dekPromise
}

export async function isVaultUnlocked() {
  return Boolean(await cachedDek())
}

export async function lockVault() {
  dekPromise = Promise.resolve(undefined)
  await writeCachedDek(undefined)
  notifyVaultChange()
}

export const VAULT_CHANGE_EVENT = 'daybook-vault-change'
function notifyVaultChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VAULT_CHANGE_EVENT))
}

/* ------------------------------------------------------------------ */
/* Vault lifecycle                                                     */
/* ------------------------------------------------------------------ */

export function normalizeRecoveryPhrase(phrase: string) {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isValidRecoveryPhrase(phrase: string) {
  return validateMnemonic(normalizeRecoveryPhrase(phrase), wordlist)
}

export async function createVault(passphrase: string): Promise<{ envelope: VaultEnvelope; recoveryPhrase: string }> {
  const rawDek = crypto.getRandomValues(new Uint8Array(32))
  const recoveryPhrase = generateMnemonic(wordlist, 128)
  const kdf = await preferredKdf()
  const envelope: VaultEnvelope = {
    wrapped_dek_passphrase: await wrapDek(rawDek, passphrase, kdf),
    wrapped_dek_recovery: await wrapDek(rawDek, normalizeRecoveryPhrase(recoveryPhrase), kdf),
  }
  await importDek(rawDek)
  rawDek.fill(0)
  return { envelope, recoveryPhrase }
}

export async function unlockWithPassphrase(envelope: VaultEnvelope, passphrase: string) {
  const rawDek = await unwrapDek(envelope.wrapped_dek_passphrase, passphrase)
  await importDek(rawDek)
  rawDek.fill(0)
}

export async function unlockWithRecoveryPhrase(envelope: VaultEnvelope, phrase: string) {
  const rawDek = await unwrapDek(envelope.wrapped_dek_recovery, normalizeRecoveryPhrase(phrase))
  await importDek(rawDek)
  rawDek.fill(0)
}

export async function changePassphrase(
  envelope: VaultEnvelope,
  currentSecret: { passphrase?: string; recoveryPhrase?: string },
  newPassphrase: string,
): Promise<VaultEnvelope> {
  const rawDek = currentSecret.passphrase !== undefined
    ? await unwrapDek(envelope.wrapped_dek_passphrase, currentSecret.passphrase)
    : await unwrapDek(envelope.wrapped_dek_recovery, normalizeRecoveryPhrase(currentSecret.recoveryPhrase ?? ''))
  const kdf = await preferredKdf()
  const next: VaultEnvelope = {
    wrapped_dek_passphrase: await wrapDek(rawDek, newPassphrase, kdf),
    wrapped_dek_recovery: envelope.wrapped_dek_recovery,
  }
  await importDek(rawDek)
  rawDek.fill(0)
  return next
}

/* ------------------------------------------------------------------ */
/* Password-protected JSON envelopes (encrypted backups)               */
/* ------------------------------------------------------------------ */

export interface PasswordEnvelope {
  daybookBackup: 1
  kdf: KdfParams
  salt: string
  iv: string
  ct: string
}

export async function encryptJsonWithPassword(value: unknown, password: string): Promise<PasswordEnvelope> {
  const kdf = await preferredKdf()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKek(password, salt, kdf)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(value)) as BufferSource,
  )
  return { daybookBackup: 1, kdf, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

export async function decryptJsonWithPassword<T>(envelope: PasswordEnvelope, password: string): Promise<T> {
  const key = await deriveKek(password, fromBase64(envelope.salt), envelope.kdf)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    key,
    fromBase64(envelope.ct) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/* ------------------------------------------------------------------ */
/* Value encryption (cloud format enc:v2:)                             */
/* ------------------------------------------------------------------ */

export async function encryptWithVault(value: string): Promise<string> {
  const dek = await cachedDek()
  if (!dek) throw new Error('vault-locked')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    new TextEncoder().encode(value) as BufferSource,
  )
  return `${CLOUD_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`
}

export async function decryptWithVault(value: string): Promise<string> {
  if (!value.startsWith(CLOUD_PREFIX)) throw new Error('not-vault-ciphertext')
  const dek = await cachedDek()
  if (!dek) throw new Error('vault-locked')
  const [iv, data] = value.slice(CLOUD_PREFIX.length).split(':')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as BufferSource },
    dek,
    fromBase64(data) as BufferSource,
  )
  return new TextDecoder().decode(decrypted)
}
