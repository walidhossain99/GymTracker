'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import type { BodyweightEntry, Exercise, ExerciseLog } from '@/lib/types'
import { bestEstimated1RM, formatDate, sessionVolume } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { ProgressLineChart } from './ProgressLineChart'
import { StatCard } from './StatCard'

export function AnalyticsClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [weights, setWeights] = useState<BodyweightEntry[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [logs, setLogs] = useState<ExerciseLog[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const user = await getCurrentUser(supabase)
    setUserId(user.id)
    const [w, e, l] = await Promise.all([
      supabase.from('bodyweight_entries').select('*').eq('user_id', user.id).order('entry_date'),
      supabase.from('exercises').select('*').eq('user_id', user.id).order('name'),
      supabase.from('exercise_logs').select('*, exercise_sets(*)').eq('user_id', user.id).order('performed_on'),
    ])
    if (w.error || e.error || l.error) setMessage(w.error?.message || e.error?.message || l.error?.message || 'Could not load analytics.')
    setWeights((w.data ?? []) as BodyweightEntry[])
    setExercises((e.data ?? []) as Exercise[])
    setLogs((l.data ?? []) as ExerciseLog[])
    setSelectedId((current) => current || e.data?.[0]?.id || '')
  }, [supabase])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(userId, ['bodyweight_entries', 'exercises', 'exercise_logs', 'exercise_sets'], load)

  const selectedLogs = logs.filter((l) => l.exercise_id === selectedId)
  const strengthData = selectedLogs.map((l) => ({ label: formatDate(l.performed_on).replace(/\s\d{4}$/, ''), e1rm: bestEstimated1RM(l.exercise_sets ?? []) }))
  const weightData = weights.map((w) => ({ label: formatDate(w.entry_date).replace(/\s\d{4}$/, ''), weight: Number(w.weight_kg) }))

  const weekly = useMemo(() => {
    const map = new Map<string, number>()
    for (const log of logs) {
      const date = new Date(`${log.performed_on}T00:00:00Z`)
      const day = date.getUTCDay() || 7
      date.setUTCDate(date.getUTCDate() - day + 1)
      const key = date.toISOString().slice(0, 10)
      map.set(key, (map.get(key) ?? 0) + sessionVolume(log.exercise_sets ?? []))
    }
    return [...map.entries()].sort(([a],[b]) => a.localeCompare(b)).slice(-12).map(([week, volume]) => ({
      label: formatDate(week).replace(/\s\d{4}$/, ''),
      volume: Math.round(volume),
    }))
  }, [logs])

  const allSets = logs.reduce((n, l) => n + (l.exercise_sets?.length ?? 0), 0)
  const totalVolume = logs.reduce((n, l) => n + sessionVolume(l.exercise_sets ?? []), 0)
  const latestWeight = weights.at(-1)
  const firstWeight = weights[0]
  const weightDelta = latestWeight && firstWeight ? Number(latestWeight.weight_kg) - Number(firstWeight.weight_kg) : null

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Long-term view</div>
        <h1 className="h1">Analytics</h1>
        <p>Use trends rather than single sessions to judge whether bodyweight, training volume and exercise performance are moving in the direction you want.</p>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="grid grid-4">
        <StatCard label="Tracked exercises" value={String(exercises.length)} />
        <StatCard label="Logged sets" value={String(allSets)} />
        <StatCard label="Recorded volume" value={`${Math.round(totalVolume).toLocaleString()} kg`} />
        <StatCard label="Bodyweight change" value={weightDelta === null ? '—' : `${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)} kg`} />
      </section>

      <section className="grid grid-2">
        <div className="card stack">
          <div><h2 className="h2">Bodyweight trend</h2><div className="muted">All recorded weigh-ins</div></div>
          <ProgressLineChart data={weightData} dataKey="weight" unit=" kg" />
        </div>

        <div className="card stack">
          <div className="row-between">
            <div><h2 className="h2">Exercise strength trend</h2><div className="muted">Best estimated 1RM per logged session</div></div>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{maxWidth:260}}>
              {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <ProgressLineChart data={strengthData} dataKey="e1rm" unit=" kg" empty="No logs yet for this exercise." />
        </div>
      </section>

      <section className="card stack">
        <div><h2 className="h2">Training volume by week</h2><div className="muted">Sum of weight × reps across logged sets, grouped by Monday-starting week.</div></div>
        {weekly.length ? (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekly} margin={{top:10,right:12,bottom:0,left:-8}}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="4 5" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{background:'#11161e',border:'1px solid #283140',borderRadius:12}} formatter={(value) => [`${Number(value).toLocaleString()} kg`, 'Volume']} />
                <Bar dataKey="volume" fill="#7dd3fc" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="empty">Training volume appears after you save workout sets.</div>}
      </section>
    </div>
  )
}
