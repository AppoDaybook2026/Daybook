/**
 * Generic Web Push registration. The server can only ever send a fixed,
 * content-free reminder at 09:00, 15:00 and 21:00 local time. No event name,
 * date or personal data is stored alongside the subscription.
 */
import { currentSession, upsertProfile } from './account'
import { supabase } from './supabaseClient'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushAvailable = Boolean(
  vapidPublicKey && supabase && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window,
)

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

/** Subscribes this device to the generic reminder push. Requires a signed-in
 *  session; local-only users keep the in-app timer notifications instead. */
export async function enablePushReminders(): Promise<boolean> {
  if (!pushAvailable) return false
  const session = await currentSession()
  if (!session) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) as BufferSource,
  })
  const json = subscription.toJSON()
  const { error } = await supabase!.from('push_subscriptions').upsert({
    user_id: session.user.id,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
  await upsertProfile(true)
  return true
}

export async function disablePushReminders() {
  if (!pushAvailable) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    await supabase!.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
    await subscription.unsubscribe()
  }
  await upsertProfile(false)
}
