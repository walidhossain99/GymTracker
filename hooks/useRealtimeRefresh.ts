'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useRealtimeRefresh(userId: string | null, tables: string[], refresh: () => void) {
  useEffect(() => {
    if (!userId || !tables.length) return
    const supabase = createClient()
    const channel = supabase.channel(`gym-sync-${tables.join('-')}-${userId}`)

    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        () => refresh()
      )
    }

    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, tables.join('|')])
}
