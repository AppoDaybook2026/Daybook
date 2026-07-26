import type { Session } from '@supabase/supabase-js'
import { db } from './db'
import { supabase } from './supabaseClient'
import { startSyncLoop, stopSyncLoop } from './sync'
import { lockVault, type VaultEnvelope } from './vault'

function required() {
  if (!supabase) throw new Error('cloud-disabled')
  return supabase
}

export async function signUp(email: string, password: string) {
  const { error } = await required().auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw new Error(error.message)
}

export async function signIn(email: string, password: string) {
  const { error } = await required().auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  await db.appMeta.put({ key: 'cloudMode', value: 'on' })
  await upsertProfile()
  startSyncLoop()
}

export async function signOut() {
  stopSyncLoop()
  await lockVault()
  await db.appMeta.put({ key: 'cloudMode', value: 'off' })
  const { error } = await required().auth.signOut()
  if (error) throw new Error(error.message)
}

export async function sendPasswordReset(email: string) {
  const { error } = await required().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  if (error) throw new Error(error.message)
}

export async function updateAccountPassword(newPassword: string) {
  const { error } = await required().auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function fetchVaultEnvelope(): Promise<VaultEnvelope | null> {
  const { data, error } = await required()
    .from('vaults')
    .select('wrapped_dek_passphrase, wrapped_dek_recovery')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as VaultEnvelope | null
}

export async function saveVaultEnvelope(envelope: VaultEnvelope) {
  const session = await currentSession()
  if (!session) throw new Error('not-signed-in')
  const { error } = await required().from('vaults').upsert({
    user_id: session.user.id,
    wrapped_dek_passphrase: envelope.wrapped_dek_passphrase,
    wrapped_dek_recovery: envelope.wrapped_dek_recovery,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function upsertProfile(remindersEnabled?: boolean) {
  const session = await currentSession()
  if (!session) return
  const payload: Record<string, unknown> = {
    user_id: session.user.id,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }
  if (remindersEnabled !== undefined) payload.reminders_enabled = remindersEnabled
  const { error } = await required().from('profiles').upsert(payload)
  if (error) throw new Error(error.message)
}
