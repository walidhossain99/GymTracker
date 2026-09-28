'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [currentMessageSignature, setCurrentMessageSignature] = useState('')
  const [seenMessageSignature, setSeenMessageSignature] = useState('')
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false)

  const loadMessageState = useCallback(async () => {
    try {
      const user = await getCurrentUser(supabase)
      setUserId(user.id)

      const [exerciseRes, routineItemRes, logRes] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', user.id).order('name'),
        supabase.from('routine_exercises').select('*').eq('user_id', user.id),
        supabase
          .from('exercise_logs')
          .select('*, exercise_sets(*), workout_sessions(routine_id, session_date)')
          .eq('user_id', user.id)
          .order('performed_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(400),
      ])

      const firstError = exerciseRes.error ?? routineItemRes.error ?? logRes.error
      if (firstError) return

      const items = buildProgressMessages(
        (exerciseRes.data ?? []) as Exercise[],
        (routineItemRes.data ?? []) as RoutineExercise[],
        (logRes.data ?? []) as unknown as LogWithSession[]
      )
      const signature = progressMessageSignature(items)
      const seen = String(user.user_metadata?.progress_messages_seen_signature ?? '')

      setCurrentMessageSignature(signature)
      setSeenMessageSignature(seen)
      setHasUnreadMessages(Boolean(signature) && signature !== seen && pathname !== '/messages')
    } catch {
      setHasUnreadMessages(false)
    }
  }, [pathname, supabase])

  useEffect(() => {
    void loadMessageState()
  }, [loadMessageState])

  useRealtimeRefresh(
    userId,
    ['exercises', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'],
    loadMessageState
  )

  useEffect(() => {
    if (pathname !== '/messages' || !currentMessageSignature || currentMessageSignature === seenMessageSignature) return

    let cancelled = false
    const markRead = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user || cancelled) return

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          ...data.user.user_metadata,
          progress_messages_seen_signature: currentMessageSignature,
        },
      })

      if (!updateError && !cancelled) {
        setSeenMessageSignature(currentMessageSignature)
        setHasUnreadMessages(false)
      }
    }

    void markRead()
    return () => { cancelled = true }
  }, [currentMessageSignature, pathname, seenMessageSignature, supabase])

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
