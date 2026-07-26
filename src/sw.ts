/// <reference lib="webworker" />
/**
 * Daybook service worker.
 *
 * Precaches the app shell (offline-first PWA) and shows the generic push
 * reminder. The push payload never contains personal content; the wording of
 * the notification is fixed and content-free by design.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Le repli navigation ne doit jamais avaler les routes serveur : sans cette
// exclusion, ouvrir /api/health afficherait l'application au lieu de la
// reponse du Worker.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  denylist: [/^\/api\//],
}))

self.skipWaiting()
clientsClaim()

const reminderBodies: Record<string, string> = {
  en: 'You have items to review in Daybook.',
  fr: 'Vous avez des éléments à consulter dans Daybook.',
  ar: 'لديك عناصر لمراجعتها في Daybook.',
}

function readStoredLanguage(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('daybook')
      request.onerror = () => resolve('en')
      request.onsuccess = () => {
        const database = request.result
        try {
          const transaction = database.transaction('appMeta', 'readonly')
          const get = transaction.objectStore('appMeta').get('language')
          get.onsuccess = () => { database.close(); resolve((get.result?.value as string) || 'en') }
          get.onerror = () => { database.close(); resolve('en') }
        } catch {
          database.close()
          resolve('en')
        }
      }
    } catch {
      resolve('en')
    }
  })
}

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil((async () => {
    const language = await readStoredLanguage()
    await self.registration.showNotification('Daybook', {
      body: reminderBodies[language] ?? reminderBodies.en,
      tag: 'daybook-generic-reminder',
      icon: undefined,
    })
  })())
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows[0]
    if (existing) await existing.focus()
    else await self.clients.openWindow('/')
  })())
})
