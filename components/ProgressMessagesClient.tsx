'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import { formatDate, formatKg, getProgressionDecision } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import type { Exercise, ExerciseLog, RoutineExercise } from '@/lib/types'

type LogWithSession = ExerciseLog & {
  workout_sessions?: { routine_id: string | null; session_date: string } | null
}

type ProgressMessage = {
  exercise: Exercise
  log: LogWithSession
  routineItem?: RoutineExercise
  status: 'increase' | 'add-reps' | 'below-range' | 'mixed-load' | 'incomplete'
  message: string
  workingWeight: number | null
  nextWeight: number | null
  targetSets: number
  repMin: number
  repMax: number
}

export function ProgressMessagesClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [items, setItems] = useState<ProgressMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
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
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const exercises = (exerciseRes.data ?? []) as Exercise[]
    const routineItems = (routineItemRes.data ?? []) as RoutineExercise[]
    const logs = ((logRes.data ?? []) as unknown as LogWithSession[]).map((log) => ({
      ...log,
      exercise_sets: [...(log.exercise_sets ?? [])].sort((a, b) => a.set_number - b.set_number),
    }))

    const latestWithSets = new Map<string, LogWithSession>()
    for (const log of logs) {
      if ((log.exercise_sets?.length ?? 0) === 0) continue
      if (!latestWithSets.has(log.exercise_id)) latestWithSets.set(log.exercise_id, log)
    }

    const nextItems: ProgressMessage[] = []
    for (const exercise of exercises) {
      const log = latestWithSets.get(exercise.id)
      if (!log) continue

      const routineId = log.workout_sessions?.routine_id ?? null
      const routineItem = routineId
        ? routineItems.find((item) => item.routine_id === routineId && item.exercise_id === exercise.id)
        : undefined

      const repMin = routineItem?.rep_min ?? exercise.rep_min
      const repMax = routineItem?.rep_max ?? exercise.rep_max
      const targetSets = routineItem?.target_sets ?? Math.max(1, log.exercise_sets?.length ?? 1)
      const decision = getProgressionDecision(
        { rep_min: repMin, rep_max: repMax, increment_kg: exercise.increment_kg },
        log,
        targetSets
      )

      if (decision.status === 'no-data') continue
      nextItems.push({
        exercise,
        log,
        routineItem,
        status: decision.status,
        message: decision.message,
        workingWeight: decision.workingWeight,
        nextWeight: decision.nextWeight,
        targetSets,
        repMin,
        repMax,
      })
    }

    nextItems.sort((a, b) => {
      const readyA = a.status === 'increase' ? 1 : 0
      const readyB = b.status === 'increase' ? 1 : 0
      if (readyA !== readyB) return readyB - readyA
      return b.log.performed_on.localeCompare(a.log.performed_on)
    })

    setItems(nextItems)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(userId, ['exercises', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'], load)

  const ready = items.filter((item) => item.status === 'increase' && item.nextWeight !== null)
  const building = items.filter((item) => item.status !== 'increase')

  function repsLine(item: ProgressMessage) {
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
                    <span>Next load</span>
                    <strong>{item.nextWeight !== null ? formatKg(item.nextWeight) : '—'}</strong>
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
                      <span>Current load</span>
                      <strong>{formatKg(item.workingWeight)}</strong>
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
        You do not need to manually clear these messages. Once you log the next session, the inbox recalculates from your newest working sets and updates the recommendation automatically.
      </div>
    </div>
  )
}
