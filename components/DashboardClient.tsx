'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureStarterData } from '@/lib/seed'
import { getCurrentUser } from '@/lib/user'
import type { BodyweightEntry, ExerciseLog, WorkoutSession } from '@/lib/types'
import { bestEstimated1RM, formatDate, formatKg } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { ProgressLineChart } from './ProgressLineChart'
import { StatCard } from './StatCard'

export function DashboardClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [weights, setWeights] = useState<BodyweightEntry[]>([])
  const [logs, setLogs] = useState<ExerciseLog[]>([])
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const user = await getCurrentUser(supabase)
      setUserId(user.id)
      await ensureStarterData(supabase, user.id)

      const [weightRes, logRes, sessionRes] = await Promise.all([
        supabase.from('bodyweight_entries').select('*').eq('user_id', user.id).order('entry_date', { ascending: true }).limit(90),
        supabase.from('exercise_logs').select('*, exercises(name), exercise_sets(*)').eq('user_id', user.id).order('performed_on', { ascending: false }).limit(30),
        supabase.from('workout_sessions').select('*, routines(name)').eq('user_id', user.id).order('started_at', { ascending: false }).limit(8),
      ])
      if (weightRes.error) throw weightRes.error
      if (logRes.error) throw logRes.error
      if (sessionRes.error) throw sessionRes.error
      setWeights((weightRes.data ?? []) as BodyweightEntry[])
      setLogs((logRes.data ?? []) as ExerciseLog[])
      setSessions((sessionRes.data ?? []) as WorkoutSession[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(userId, ['bodyweight_entries', 'exercise_logs', 'exercise_sets', 'workout_sessions'], load)

  const latestWeight = weights.at(-1)
  const firstWeight = weights[0]
  const weightChange = latestWeight && firstWeight ? Number(latestWeight.weight_kg) - Number(firstWeight.weight_kg) : null
  const completedSessions = sessions.filter((s) => s.completed_at)

  const strongest = logs
    .map((log) => ({ log, e1rm: bestEstimated1RM(log.exercise_sets ?? []) }))
    .sort((a, b) => b.e1rm - a.e1rm)[0]

  const weightChart = weights.map((w) => ({
    label: formatDate(w.entry_date).replace(/\s\d{4}$/, ''),
    weight: Number(w.weight_kg),
  }))

  if (loading) return <div className="container"><div className="page-head"><h1 className="h1">Loading your progress…</h1></div></div>

  return (
    <div className="container stack">
      <header className="page-head row-between">
        <div>
          <div className="eyebrow">Cloud synced</div>
          <h1 className="h1">Your progression dashboard</h1>
          <p>At-a-glance bodyweight, training activity and strength progress. Changes made on another open device are pulled in automatically.</p>
        </div>
        <Link className="btn btn-primary" href="/workouts">Start workout</Link>
      </header>

      {error && <div className="notice">{error}</div>}

      <section className="grid grid-4">
        <StatCard label="Current bodyweight" value={latestWeight ? formatKg(Number(latestWeight.weight_kg)) : '—'} sub={latestWeight ? formatDate(latestWeight.entry_date) : 'Add your first weigh-in'} />
        <StatCard label="Weight change" value={weightChange === null ? '—' : `${weightChange >= 0 ? '+' : ''}${weightChange.toFixed(1)} kg`} sub="Across saved weigh-ins" />
        <StatCard label="Recent workouts" value={String(completedSessions.length)} sub="Among latest 8 sessions" />
        <StatCard label="Best recent e1RM" value={strongest?.e1rm ? formatKg(strongest.e1rm) : '—'} sub={strongest?.log.exercises?.name ?? 'Log sets to calculate'} />
      </section>

      <section className="grid grid-2">
        <div className="card stack">
          <div className="row-between"><div><h2 className="h2">Bodyweight trend</h2><div className="muted">Up to your latest 90 entries</div></div><Link href="/bodyweight" className="btn btn-ghost">Open</Link></div>
          <ProgressLineChart data={weightChart} dataKey="weight" unit=" kg" empty="Add a bodyweight entry to begin the trend chart." />
        </div>
        <div className="card stack">
          <div className="row-between"><div><h2 className="h2">Recent activity</h2><div className="muted">Your latest workout sessions</div></div><Link href="/workouts" className="btn btn-ghost">Workouts</Link></div>
          {sessions.length ? sessions.slice(0, 6).map((session) => (
            <div className="card-soft row-between" key={session.id}>
              <div>
                <strong>{session.routines?.name ?? 'Custom workout'}</strong>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{formatDate(session.session_date)}</div>
              </div>
              <span className={session.completed_at ? 'badge badge-good' : 'badge'}>{session.completed_at ? 'Completed' : 'In progress'}</span>
            </div>
          )) : <div className="empty">No workout sessions yet.</div>}
        </div>
      </section>

      <section className="card stack">
        <div><h2 className="h2">What to do next</h2><p className="muted">The fastest workflow is: weigh in when useful, start a routine, save each working set, then finish the session.</p></div>
        <div className="grid grid-3">
          <Link className="card-soft" href="/bodyweight"><strong>1 · Bodyweight</strong><div className="muted" style={{marginTop:5}}>Track scale weight and optional body-fat %.</div></Link>
          <Link className="card-soft" href="/workouts"><strong>2 · Train</strong><div className="muted" style={{marginTop:5}}>Log sets immediately; they sync to the cloud.</div></Link>
          <Link className="card-soft" href="/exercises"><strong>3 · Progress</strong><div className="muted" style={{marginTop:5}}>See e1RM, volume and next-load guidance per exercise.</div></Link>
        </div>
      </section>
    </div>
  )
}
