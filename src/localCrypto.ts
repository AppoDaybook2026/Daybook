const prefix = 'enc:v1:'
let keyPromise: Promise<CryptoKey> | undefined

function openKeyDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('daybook-local-keys', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('keys')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function localKey() {
  if (keyPromise) return keyPromise
  keyPromise = (async () => {
    const database = await openKeyDatabase()
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = database.transaction('keys', 'readonly').objectStore('keys').get('primary')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (existing) {
      database.close()
      return existing
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction('keys', 'readwrite').objectStore('keys').put(key, 'primary')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
    return key
  })()
  return keyPromise
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function encryptLocal(value: string) {
  if (!value || value.startsWith(prefix)) return value
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(value)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await localKey(), data)
  return `${prefix}${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`
}

export async function decryptLocal(value = '') {
  if (!value.startsWith(prefix)) return value
  const [iv, data] = value.slice(prefix.length).split(':')
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await localKey(), fromBase64(data))
    return new TextDecoder().decode(decrypted)
  } catch {
    return ''
  }
}
