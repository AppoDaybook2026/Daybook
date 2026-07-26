import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Cloud features are entirely optional: without configuration the app stays
 *  a pure local-first PWA, exactly as before. */
export const cloudEnabled = Boolean(url && anonKey)

export const supabase: SupabaseClient | undefined = cloudEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : undefined
