-- Daybook — initial schema.
-- Every personal value reaches this database already encrypted (AES-GCM) with
-- a key that never leaves the user's devices. Administrators only ever see
-- ciphertext, uuids and timestamps.

-- Non-sensitive per-user metadata (timezone drives the 09/15/21 reminders).
create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  timezone text not null default 'UTC',
  reminders_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The vault: the data-encryption key exists here ONLY in wrapped (encrypted)
-- form — once under the user's vault passphrase, once under their 12-word
-- recovery phrase. Neither secret is ever transmitted or stored anywhere.
create table public.vaults (
  user_id uuid primary key references auth.users on delete cascade,
  wrapped_dek_passphrase jsonb not null,
  wrapped_dek_recovery jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- All application data: opaque encrypted blobs.
create table public.records (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null,
  collection text not null check (collection in
    ('task','dailyTask','timeSession','milestone','subactivity','deadline','appMeta')),
  payload text not null,
  client_rev bigint not null default 1,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index records_user_updated on public.records (user_id, updated_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- Server-side updated_at so the sync cursor never depends on client clocks.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger vaults_touch before update on public.vaults
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------
-- Row Level Security: every row belongs to exactly one user; nobody can
-- read or write another user's rows, even with hand-crafted API calls.
-- -------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.vaults enable row level security;
alter table public.records enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles
create policy "profiles_select" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete" on public.profiles for delete using (auth.uid() = user_id);

-- vaults
create policy "vaults_select" on public.vaults for select using (auth.uid() = user_id);
create policy "vaults_insert" on public.vaults for insert with check (auth.uid() = user_id);
create policy "vaults_update" on public.vaults for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vaults_delete" on public.vaults for delete using (auth.uid() = user_id);

-- records
create policy "records_select" on public.records for select using (auth.uid() = user_id);
create policy "records_insert" on public.records for insert with check (auth.uid() = user_id);
create policy "records_update" on public.records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records_delete" on public.records for delete using (auth.uid() = user_id);

-- push_subscriptions
create policy "push_select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "push_insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push_update" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_delete" on public.push_subscriptions for delete using (auth.uid() = user_id);

-- Anonymous visitors have no access at all.
revoke all on public.profiles, public.vaults, public.records, public.push_subscriptions from anon;

-- Helper used by the reminder Edge Function (executed with service role):
-- returns users whose LOCAL time is 09:00, 15:00 or 21:00 right now.
create or replace function public.users_due_for_reminder()
returns table (user_id uuid) language sql security definer set search_path = public as $$
  select p.user_id
  from public.profiles p
  where p.reminders_enabled
    and extract(hour from (now() at time zone p.timezone)) in (9, 15, 21);
$$;
revoke all on function public.users_due_for_reminder() from public, anon, authenticated;
