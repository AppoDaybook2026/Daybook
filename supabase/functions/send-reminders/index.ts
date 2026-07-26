// Daybook — generic reminder sender (Supabase Edge Function, Deno).
//
// Privacy contract: this function can only ever send a FIXED, content-free
// payload. It has no access to decrypted user content (the database stores
// ciphertext only), and it never logs endpoints or user identifiers.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('forbidden', { status: 403 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const { data: due, error } = await supabase.rpc('users_due_for_reminder')
  if (error) return new Response('rpc error', { status: 500 })
  if (!due?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

  const userIds = due.map((row: { user_id: string }) => row.user_id)
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds)

  let sent = 0
  for (const subscription of subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        // Deliberately empty: the service worker shows a fixed generic text.
        '',
        { TTL: 3600 },
      )
      sent += 1
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      }
    }
  }
  return new Response(JSON.stringify({ sent }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
