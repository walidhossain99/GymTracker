'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatKg } from '@/lib/metrics'
import { buildProgressMessages } from '@/lib/progressInbox'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import type { Exercise, RoutineExercise } from '@/lib/types'
import type { LogWithSession, ProgressMessageItem } from '@/lib/progressInbox'

export function ProgressMessagesClient({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState<ProgressMessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [exerciseRes, routineItemRes, logRes] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', userId).order('name'),
        supabase.from('routine_exercises').select('*').eq('user_id', userId),
        supabase
          .from('exercise_logs')
          .select('*, exercise_sets(*), workout_sessions(routine_id, session_date)')
          .eq('user_id', userId)
          .order('performed_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(400),
      ])

      const firstError = exerciseRes.error ?? routineItemRes.error ?? logRes.error
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      setItems(buildProgressMessages(
        (exerciseRes.data ?? []) as Exercise[],
        (routineItemRes.data ?? []) as RoutineExercise[],
        (logRes.data ?? []) as unknown as LogWithSession[]
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load progression messages.')
    } finally {
      setLoading(false)
    }
  }, [supabase, userId])

  useEffect(() => { void load() }, [load])
  useRealtimeRefresh(userId, ['exercises', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'], load)

  const ready = items.filter((item) => item.status === 'increase' && item.nextWeight !== null)
  const building = items.filter((item) => item.status !== 'increase')

  function repsLine(item: ProgressMessageItem) {
    const sets = [...(item.log.exercise_sets ?? [])]
      .sort((a, b) => a.set_number - b.set_number)
      .slice(0, item.targetSets)
    if (!sets.length) return '—'
    return sets.map((set) => set.reps).join(' / ')
  }

  return (
    <div className="container">
      <div className="page-head">
        <div className="eyebrow">Progress center</div>
        <h1 className="h1">Messages</h1>
        <p>Your next-session reminders are generated automatically from your latest completed working sets, so you can check what needs to increase before or during your workout.</p>
      </div>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="eyebrow">Load increases</div>
          <div className="stat-value">{ready.length}</div>
          <div className="muted" style={{ fontSize: 13 }}>Exercises ready for more weight</div>
        </div>
        <div className="card">
          <div className="eyebrow">Keep building</div>
          <div className="stat-value">{building.length}</div>
          <div className="muted" style={{ fontSize: 13 }}>Exercises still progressing at the current load</div>
        </div>
        <div className="card">
          <div className="eyebrow">How it works</div>
          <div style={{ fontWeight: 800, marginTop: 7 }}>Automatic</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>A reminder updates when you log your next working sets.</div>
        </div>
      </div>

      <section className="stack" style={{ marginBottom: 18 }}>
        <div className="row-between">
          <div>
            <h2 className="h2">Increase next session</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>These exercises cleared the top of the programmed rep range across all required working sets.</div>
          </div>
          <Link className="btn btn-primary" href="/workouts">Open workouts</Link>
        </div>

        {loading ? (
          <div className="card empty">Checking your latest progression data…</div>
        ) : ready.length === 0 ? (
          <div className="card empty">No load increases are pending right now. When you clear the upper rep target on every programmed set, the reminder will appear here.</div>
        ) : (
          <div className="progress-message-grid">
            {ready.map((item) => (
              <article className="card progress-message-card progress-message-ready" key={item.exercise.id}>
                <div className="row-between progress-message-top">
                  <div>
                    <span className="badge badge-good">↑ INCREASE NEXT SESSION</span>
                    <h3>{item.exercise.name}</h3>
                    <div className="muted" style={{ fontSize: 13 }}>{item.exercise.muscle_group ?? 'Exercise'} · Last logged {formatDate(item.log.performed_on)}</div>
                  </div>
                  <div className="progress-message-load">
                    <span className="progress-message-load-label">Next load</span>
                    <strong className="progress-message-load-value">{item.nextWeight !== null ? formatKg(item.nextWeight) : '—'}</strong>
                  </div>
                </div>

                <div className="progress-message-detail-grid">
                  <div className="card-soft">
                    <span className="eyebrow">Cleared load</span>
                    <strong>{item.workingWeight !== null ? formatKg(item.workingWeight) : '—'}</strong>
                  </div>
                  <div className="card-soft">
                    <span className="eyebrow">Logged reps</span>
                    <strong>{repsLine(item)}</strong>
                  </div>
                  <div className="card-soft">
                    <span className="eyebrow">Target</span>
                    <strong>{item.targetSets} × {item.repMin}–{item.repMax}</strong>
                  </div>
                </div>

                <p className="progress-message-text">{item.message}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {!loading && building.length > 0 && (
        <section className="stack">
          <div>
            <h2 className="h2">Current-load reminders</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Useful when you want a quick reminder of what you were trying to beat next time.</div>
          </div>
          <div className="progress-message-grid">
            {building.map((item) => (
              <article className="card progress-message-card" key={item.exercise.id}>
                <div className="row-between progress-message-top">
                  <div>
                    <span className="badge">KEEP BUILDING</span>
                    <h3>{item.exercise.name}</h3>
                    <div className="muted" style={{ fontSize: 13 }}>Last logged {formatDate(item.log.performed_on)}</div>
                  </div>
                  {item.workingWeight !== null && (
                    <div className="progress-message-load progress-message-load-muted">
                      <span className="progress-message-load-label">Current load</span>
                      <strong className="progress-message-load-value">{formatKg(item.workingWeight)}</strong>
                    </div>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>Reps: {repsLine(item)} · Target {item.targetSets} × {item.repMin}–{item.repMax}</div>
                <p className="progress-message-text">{item.message}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="notice" style={{ marginTop: 18 }}>
        Opening Messages marks the current progression updates as read. If your latest workout changes a recommendation later, the unread dot returns automatically.
      </div>
    </div>
  )
}
