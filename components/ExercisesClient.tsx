'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import type { Exercise, ExerciseLog, ExerciseSet } from '@/lib/types'
import { bestEstimated1RM, formatDate, formatKg, progressionRecommendation, sessionVolume, todayLocalISO } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { ProgressLineChart } from './ProgressLineChart'
import { StatCard } from './StatCard'

type SetDraft = { weight: string; reps: string }
type ExercisePayload = { name: string; muscle: string; repMin: number; repMax: number; increment: number }

export function ExercisesClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null)
  const [logs, setLogs] = useState<ExerciseLog[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const loadExercises = useCallback(async () => {
    const user = await getCurrentUser(supabase)
    setUserId(user.id)
    const { data, error } = await supabase.from('exercises').select('*').eq('user_id', user.id).order('name')
    if (error) return setMessage(error.message)
    const list = (data ?? []) as Exercise[]
    setExercises(list)
    setSelectedId((current) => current && list.some((e) => e.id === current) ? current : list[0]?.id ?? null)
  }, [supabase])

  const loadLogs = useCallback(async () => {
    if (!userId || !selectedId) return setLogs([])
    const { data, error } = await supabase
      .from('exercise_logs')
      .select('*, exercise_sets(*)')
      .eq('user_id', userId)
      .eq('exercise_id', selectedId)
      .order('performed_on', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(100)
    if (error) setMessage(error.message)
    else setLogs(((data ?? []) as ExerciseLog[]).map((l) => ({ ...l, exercise_sets: (l.exercise_sets ?? []).sort((a,b) => a.set_number-b.set_number) })))
  }, [supabase, userId, selectedId])

  useEffect(() => { loadExercises() }, [loadExercises])
  useEffect(() => { loadLogs() }, [loadLogs])
  useRealtimeRefresh(userId, ['exercises'], loadExercises)
  useRealtimeRefresh(userId, ['exercise_logs', 'exercise_sets'], loadLogs)

  const selected = exercises.find((e) => e.id === selectedId) ?? null
  const latest = logs.at(-1) ?? null
  const best = Math.max(0, ...logs.map((l) => bestEstimated1RM(l.exercise_sets ?? [])))
  const latestVolume = latest ? sessionVolume(latest.exercise_sets ?? []) : 0
  const firstRm = logs[0] ? bestEstimated1RM(logs[0].exercise_sets ?? []) : 0
  const latestRm = latest ? bestEstimated1RM(latest.exercise_sets ?? []) : 0
  const strengthChange = firstRm > 0 ? ((latestRm - firstRm) / firstRm) * 100 : null
  const chart = logs.map((l) => ({ label: formatDate(l.performed_on).replace(/\s\d{4}$/, ''), e1rm: bestEstimated1RM(l.exercise_sets ?? []) }))

  async function addExercise(payload: ExercisePayload) {
    if (!userId) return
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.from('exercises').insert({
      user_id: userId,
      name: payload.name,
      muscle_group: payload.muscle || null,
      rep_min: payload.repMin,
      rep_max: payload.repMax,
      increment_kg: payload.increment,
    }).select().single()
    setBusy(false)
    if (error) setMessage(error.message)
    else {
      setSelectedId(data.id)
      setMessage('Exercise added.')
      loadExercises()
    }
  }

  async function updateExercise(payload: ExercisePayload, updateRoutineTargets: boolean) {
    if (!userId || !selected) return
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('exercises').update({
      name: payload.name,
      muscle_group: payload.muscle || null,
      rep_min: payload.repMin,
      rep_max: payload.repMax,
      increment_kg: payload.increment,
    }).eq('id', selected.id).eq('user_id', userId)

    if (error) {
      setBusy(false)
      setMessage(error.message)
      return
    }

    if (updateRoutineTargets) {
      const { error: routineError } = await supabase.from('routine_exercises').update({
        rep_min: payload.repMin,
        rep_max: payload.repMax,
      }).eq('user_id', userId).eq('exercise_id', selected.id)
      if (routineError) {
        setBusy(false)
        setMessage(`Exercise updated, but routine targets could not be updated: ${routineError.message}`)
        await loadExercises()
        return
      }
    }

    setBusy(false)
    setEditingExerciseId(null)
    setMessage(updateRoutineTargets ? 'Exercise and routine targets updated.' : 'Exercise settings updated.')
    await loadExercises()
  }

  async function removeExercise() {
    if (!selected || !confirm(`Delete ${selected.name} and all of its history? This also removes it from every routine.`)) return
    const { error } = await supabase.from('exercises').delete().eq('id', selected.id)
    if (error) setMessage(error.message)
    else {
      setLogs([])
      setSelectedId(null)
      setEditingExerciseId(null)
      loadExercises()
    }
  }

  async function saveStandaloneLog(date: string, sets: SetDraft[]) {
    if (!userId || !selected) return
    const parsed = sets.map((s) => ({ weight_kg: Number(s.weight), reps: Number(s.reps) }))
    if (parsed.some((s) => !Number.isFinite(s.weight_kg) || s.weight_kg < 0 || !Number.isInteger(s.reps) || s.reps < 1)) {
      setMessage('Check the weight and rep values for every set.')
      return
    }
    setBusy(true)
    const { data: log, error: logError } = await supabase.from('exercise_logs').insert({
      user_id: userId,
      exercise_id: selected.id,
      performed_on: date,
      order_index: 0,
    }).select().single()
    if (logError || !log) {
      setBusy(false)
      return setMessage(logError?.message ?? 'Could not create exercise log.')
    }
    const { error: setError } = await supabase.from('exercise_sets').insert(parsed.map((set, index) => ({
      user_id: userId,
      exercise_log_id: log.id,
      set_number: index + 1,
      ...set,
    })))
    setBusy(false)
    if (setError) setMessage(setError.message)
    else {
      setMessage('Session saved.')
      loadLogs()
    }
  }

  async function deleteLog(id: string) {
    await supabase.from('exercise_logs').delete().eq('id', id)
    loadLogs()
  }

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Strength database</div>
        <h1 className="h1">Exercises</h1>
        <p>Every lift has its own progression history, volume, estimated strength trend and automatic next-session guidance.</p>
      </header>

      {message && <div className="notice">{message}</div>}

      <div className="two-column-main">
        <div className="stack">
          <ExerciseCreateForm onAdd={addExercise} busy={busy} />
          <div className="card stack">
            <div className="row-between"><h2 className="h2">Exercise library</h2><span className="badge">{exercises.length}</span></div>
            <div className="exercise-list">
              {exercises.map((e) => (
                <button key={e.id} className={`btn ${selectedId === e.id ? 'btn-primary' : ''}`} onClick={() => { setSelectedId(e.id); setEditingExerciseId(null) }}>
                  <div>{e.name}</div><div style={{ fontSize: 11, opacity: .7, marginTop: 3 }}>{e.muscle_group || 'Uncategorized'} · {e.rep_min}–{e.rep_max} reps · +{Number(e.increment_kg)} kg</div>
                </button>
              ))}
              {!exercises.length && <div className="empty">No exercises yet.</div>}
            </div>
          </div>
        </div>

        {selected ? (
          <div className="stack">
            <div className="card stack">
              <div className="row-between">
                <div><div className="eyebrow">{selected.muscle_group || 'Exercise'}</div><h2 className="h2" style={{ marginTop: 5 }}>{selected.name}</h2><div className="muted">Target {selected.rep_min}–{selected.rep_max} reps · +{Number(selected.increment_kg)} kg progression step</div></div>
                <div className="row">
                  <button className="btn" onClick={() => setEditingExerciseId(editingExerciseId === selected.id ? null : selected.id)}>{editingExerciseId === selected.id ? 'Close editor' : 'Edit settings'}</button>
                  <button className="btn btn-danger" onClick={removeExercise}>Delete</button>
                </div>
              </div>
              <div className="grid grid-3">
                <StatCard label="Best estimated 1RM" value={best ? formatKg(best) : '—'} />
                <StatCard label="Latest volume" value={latest ? `${Math.round(latestVolume).toLocaleString()} kg` : '—'} />
                <StatCard label="Strength change" value={strengthChange === null ? '—' : `${strengthChange >= 0 ? '+' : ''}${strengthChange.toFixed(1)}%`} />
              </div>
            </div>

            {editingExerciseId === selected.id && (
              <ExerciseEditForm key={selected.id} exercise={selected} onSave={updateExercise} onCancel={() => setEditingExerciseId(null)} busy={busy} />
            )}

            <div className="card stack">
              <div><h2 className="h2">Progression guidance</h2><div className="muted" style={{ marginTop: 7 }}>{progressionRecommendation(selected, latest)}</div></div>
            </div>

            <ExerciseLogForm onSave={saveStandaloneLog} busy={busy} latest={latest} />

            <div className="card stack">
              <div><h2 className="h2">Strength progression</h2><div className="muted">Estimated 1RM is used as a trend metric, not a prescription to max out.</div></div>
              <ProgressLineChart data={chart} dataKey="e1rm" unit=" kg" empty="Log this exercise to generate its progression chart." />
            </div>

            <div className="card stack">
              <h2 className="h2">History</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Sets</th><th>Best e1RM</th><th>Volume</th><th /></tr></thead>
                  <tbody>
                    {logs.slice().reverse().map((log) => (
                      <tr key={log.id}>
                        <td>{formatDate(log.performed_on)}</td>
                        <td>{(log.exercise_sets ?? []).map((s: ExerciseSet) => `${Number(s.weight_kg)}×${s.reps}`).join(' · ') || '—'}</td>
                        <td>{formatKg(bestEstimated1RM(log.exercise_sets ?? []))}</td>
                        <td>{Math.round(sessionVolume(log.exercise_sets ?? [])).toLocaleString()} kg</td>
                        <td><button className="btn btn-danger" onClick={() => deleteLog(log.id)}>Delete</button></td>
                      </tr>
                    ))}
                    {!logs.length && <tr><td colSpan={5}><div className="empty">No history yet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : <div className="card empty">Choose or create an exercise.</div>}
      </div>
    </div>
  )
}

function ExerciseCreateForm({ onAdd, busy }: { onAdd: (p: ExercisePayload) => void; busy: boolean }) {
  const [name, setName] = useState('')
  const [muscle, setMuscle] = useState('')
  const [repMin, setRepMin] = useState('6')
  const [repMax, setRepMax] = useState('8')
  const [increment, setIncrement] = useState('2.5')
  function submit(e: FormEvent) {
    e.preventDefault()
    const min = Number(repMin), max = Number(repMax), inc = Number(increment)
    if (!name.trim() || min < 1 || max < min || inc < 0) return
    onAdd({ name: name.trim(), muscle: muscle.trim(), repMin: min, repMax: max, increment: inc })
    setName(''); setMuscle('')
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <div><h2 className="h2">Add exercise</h2><div className="muted">Set defaults here. You can edit them later at any time.</div></div>
      <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Barbell Bench Press" /></label>
      <label>Muscle group<input value={muscle} onChange={(e) => setMuscle(e.target.value)} placeholder="Chest" /></label>
      <div className="grid grid-2"><label>Rep min<input type="number" min="1" max="100" value={repMin} onChange={(e) => setRepMin(e.target.value)} /></label><label>Rep max<input type="number" min="1" max="100" value={repMax} onChange={(e) => setRepMax(e.target.value)} /></label></div>
      <label>Weight increase when target cleared (kg)<input type="number" min="0" step="0.01" inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} /></label>
      <button className="btn btn-primary" disabled={busy}>Add exercise</button>
    </form>
  )
}

function ExerciseEditForm({ exercise, onSave, onCancel, busy }: {
  exercise: Exercise
  onSave: (payload: ExercisePayload, updateRoutineTargets: boolean) => Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  const [name, setName] = useState(exercise.name)
  const [muscle, setMuscle] = useState(exercise.muscle_group ?? '')
  const [repMin, setRepMin] = useState(String(exercise.rep_min))
  const [repMax, setRepMax] = useState(String(exercise.rep_max))
  const [increment, setIncrement] = useState(String(exercise.increment_kg))
  const [updateRoutines, setUpdateRoutines] = useState(true)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const min = Number(repMin), max = Number(repMax), inc = Number(increment)
    if (!name.trim() || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || !Number.isFinite(inc) || inc < 0) return
    await onSave({ name: name.trim(), muscle: muscle.trim(), repMin: min, repMax: max, increment: inc }, updateRoutines)
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row-between">
        <div><h2 className="h2">Edit exercise settings</h2><div className="muted" style={{ marginTop: 5 }}>Change the exercise name, rep range or progression jump without deleting its history.</div></div>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
      <div className="grid grid-2">
        <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Muscle group<input value={muscle} onChange={(e) => setMuscle(e.target.value)} /></label>
      </div>
      <div className="grid grid-3">
        <label>Rep min<input required type="number" min="1" max="100" value={repMin} onChange={(e) => setRepMin(e.target.value)} /></label>
        <label>Rep max<input required type="number" min="1" max="100" value={repMax} onChange={(e) => setRepMax(e.target.value)} /></label>
        <label>Load increase (kg)<input required type="number" min="0" step="0.01" inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} /></label>
      </div>
      <label className="card-soft" style={{ display: 'flex', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
        <input type="checkbox" checked={updateRoutines} onChange={(e) => setUpdateRoutines(e.target.checked)} style={{ width: 18, minHeight: 18 }} />
        <span><strong>Apply the new rep range to routines that use this exercise</strong><span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 3 }}>Turn this off if a particular workout day intentionally uses a different rep range.</span></span>
      </label>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save exercise changes'}</button>
    </form>
  )
}

function ExerciseLogForm({ onSave, busy, latest }: { onSave: (date: string, sets: SetDraft[]) => void; busy: boolean; latest: ExerciseLog | null }) {
  const [date, setDate] = useState(todayLocalISO())
  const [sets, setSets] = useState<SetDraft[]>(() => Array.from({ length: 3 }, () => ({ weight: '', reps: '' })))

  useEffect(() => {
    if (!latest?.exercise_sets?.length) return
    setSets(latest.exercise_sets.map((s) => ({ weight: String(s.weight_kg), reps: '' })))
  }, [latest?.id])

  function update(index: number, key: keyof SetDraft, value: string) {
    setSets((current) => current.map((s, i) => i === index ? { ...s, [key]: value } : s))
  }

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSave(date, sets) }}>
      <div className="row-between"><div><h2 className="h2">Quick exercise log</h2><div className="muted">For a full routine, use the Workouts page.</div></div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} /></div>
      <div className="stack">
        {sets.map((set, i) => <div className="set-row" key={i}><strong>#{i + 1}</strong><label>Weight kg<input required type="number" min="0" step="0.01" inputMode="decimal" value={set.weight} onChange={(e) => update(i, 'weight', e.target.value)} /></label><label>Reps<input required type="number" min="1" max="200" value={set.reps} onChange={(e) => update(i, 'reps', e.target.value)} /></label><button type="button" className="btn btn-danger set-action" onClick={() => setSets((s) => s.filter((_, x) => x !== i))}>Remove</button></div>)}
      </div>
      <div className="row"><button type="button" className="btn" onClick={() => setSets((s) => [...s, { weight: s.at(-1)?.weight ?? '', reps: '' }])}>+ Set</button><button className="btn btn-primary" disabled={busy || !sets.length}>Save session</button></div>
    </form>
  )
}
