'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buildProgressMessages, progressMessageSignature } from '@/lib/progressInbox'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import type { Exercise, RoutineExercise } from '@/lib/types'
import type { LogWithSession } from '@/lib/progressInbox'

const nav = [
  ['/dashboard', 'Dashboard'],
  ['/workouts', 'Workouts'],
  ['/bodyweight', 'Bodyweight'],
  ['/exercises', 'Exercises'],
  ['/messages', 'Messages'],
  ['/analytics', 'Analytics'],
] as const

export function AppShell({ children, userId }: { children: React.ReactNode; userId: string }) {
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false)

  const loadMessageState = useCallback(async () => {
    try {
      const [exerciseRes, routineItemRes, logRes, profileRes] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', userId).order('name'),
        supabase.from('routine_exercises').select('*').eq('user_id', userId),
        supabase
          .from('exercise_logs')
          .select('*, exercise_sets(*), workout_sessions(routine_id, session_date)')
          .eq('user_id', userId)
          .order('performed_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(400),
        supabase
          .from('profiles')
          .select('progress_messages_seen_signature')
          .eq('id', userId)
          .maybeSingle(),
      ])

      const firstError = exerciseRes.error ?? routineItemRes.error ?? logRes.error
      if (firstError) {
        setHasUnreadMessages(false)
        return
      }

      const items = buildProgressMessages(
        (exerciseRes.data ?? []) as Exercise[],
        (routineItemRes.data ?? []) as RoutineExercise[],
        (logRes.data ?? []) as unknown as LogWithSession[]
      )
      const signature = progressMessageSignature(items)
      let seen = profileRes.error
        ? ''
        : String(profileRes.data?.progress_messages_seen_signature ?? '')

      if (pathname === '/messages' && signature && signature !== seen && !profileRes.error) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ progress_messages_seen_signature: signature })
          .eq('id', userId)

        if (!updateError) seen = signature
      }

      setHasUnreadMessages(Boolean(signature) && signature !== seen && pathname !== '/messages')
    } catch {
      // The shell must never take down the app just because the inbox check failed.
      setHasUnreadMessages(false)
    }
  }, [pathname, supabase, userId])

  useEffect(() => {
    void loadMessageState()
  }, [loadMessageState])

  useRealtimeRefresh(
    userId,
    ['exercises', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'],
    loadMessageState
  )

  // Keep the read/unread state in sync across open devices without touching auth metadata.
  useEffect(() => {
    const channel = supabase
      .channel(`progress-inbox-profile-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => { void loadMessageState() }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadMessageState, supabase, userId])

  const navLinks = nav.map(([href, label]) => (
    <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
      <span className="nav-item-label">
        {label}
        {href === '/messages' && hasUnreadMessages && (
          <span
            className="message-unread-dot"
            aria-label="Unread progression update"
            title="Unread progression update"
          />
        )}
      </span>
    </Link>
  ))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-dot" /> Progress Forge
        </Link>
        <nav className="nav">{navLinks}</nav>
        <div className="sidebar-footer">
          <div className="card-soft muted" style={{ fontSize: 12 }}>
            <span className="live-dot" />Cloud sync enabled
          </div>
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost" style={{ width: '100%' }}>Sign out</button>
          </form>
        </div>
      </aside>
      <main className="app-main">
        <nav className="mobile-nav">{navLinks}</nav>
        {children}
      </main>
    </div>
  )
}
