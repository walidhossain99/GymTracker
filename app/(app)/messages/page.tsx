import { redirect } from 'next/navigation'
import { ProgressMessagesClient } from '@/components/ProgressMessagesClient'
import { createClient } from '@/lib/supabase/server'

export default async function MessagesPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) redirect('/login')

  return <ProgressMessagesClient userId={String(data.claims.sub)} />
}
