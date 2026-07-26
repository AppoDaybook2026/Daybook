/**
 * Cross-user isolation test — runs against a REAL Supabase project.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   USER_A_EMAIL=... USER_A_PASSWORD=... \
 *   USER_B_EMAIL=... USER_B_PASSWORD=... \
 *   npm run test:rls
 *
 * The two accounts must exist and be email-confirmed beforehand.
 * Verifies that user B can never read, forge, update or delete user A's rows.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const env = (name) => {
  const value = process.env[name]
  if (!value) { console.error(`Missing env var ${name}`); process.exit(2) }
  return value
}

const url = env('SUPABASE_URL')
const anonKey = env('SUPABASE_ANON_KEY')

let failures = 0
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

async function signedInClient(email, password) {
  const client = createClient(url, anonKey)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) { console.error(`Sign-in failed for ${email}: ${error.message}`); process.exit(2) }
  return client
}

const a = await signedInClient(env('USER_A_EMAIL'), env('USER_A_PASSWORD'))
const b = await signedInClient(env('USER_B_EMAIL'), env('USER_B_PASSWORD'))
const userA = (await a.auth.getUser()).data.user.id
const userB = (await b.auth.getUser()).data.user.id

// A inserts a (ciphertext) record.
const recordId = randomUUID()
{
  const { error } = await a.from('records').insert({
    user_id: userA, id: recordId, collection: 'task', payload: 'enc:v2:test-ciphertext', deleted: false,
  })
  check('A can insert their own record', !error)
}

// B cannot see it.
{
  const { data } = await b.from('records').select('id').eq('id', recordId)
  check('B cannot read A record (empty result)', (data ?? []).length === 0)
}

// B cannot forge a row owned by A (insert with A user_id).
{
  const { error } = await b.from('records').insert({
    user_id: userA, id: randomUUID(), collection: 'task', payload: 'enc:v2:forged', deleted: false,
  })
  check('B cannot insert a row with A user_id', Boolean(error))
}

// B cannot update or delete A's row (0 rows affected).
{
  const { data } = await b.from('records').update({ payload: 'enc:v2:tampered' }).eq('id', recordId).select()
  check('B cannot update A record', (data ?? []).length === 0)
}
{
  const { data } = await b.from('records').delete().eq('id', recordId).select()
  check('B cannot delete A record', (data ?? []).length === 0)
}

// Vaults: B cannot read A's wrapped keys.
{
  const { data } = await b.from('vaults').select('user_id').eq('user_id', userA)
  check('B cannot read A vault', (data ?? []).length === 0)
}

// Anonymous access is fully blocked.
{
  const anonymous = createClient(url, anonKey)
  const { data, error } = await anonymous.from('records').select('id').limit(1)
  check('anonymous cannot read records', Boolean(error) || (data ?? []).length === 0)
}

// A still sees their intact record; then cleans up.
{
  const { data } = await a.from('records').select('payload').eq('id', recordId).single()
  check('A record intact after attack attempts', data?.payload === 'enc:v2:test-ciphertext')
  await a.from('records').delete().eq('id', recordId)
}

console.log(failures === 0 ? '\nAll RLS isolation checks passed.' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
