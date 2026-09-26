import type { SupabaseClient } from '@supabase/supabase-js'

export async function getCurrentUser(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw error ?? new Error('Not signed in')
  return data.user
}
