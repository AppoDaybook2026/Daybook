-- Schedules the generic reminder Edge Function every hour at minute 0.
-- The function itself filters users whose local time is 09:00, 15:00 or 21:00.
--
-- BEFORE running this migration:
--   1. Deploy the Edge Function:  supabase functions deploy send-reminders --no-verify-jwt
--   2. Set its secrets:           supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<random-string>
--   3. Replace the two placeholders below (<PROJECT-REF>, <CRON-SECRET>).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daybook-generic-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('x-cron-secret', '<CRON-SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
