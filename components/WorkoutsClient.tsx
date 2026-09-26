'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import { ensureStarterData } from '@/lib/seed'
import type { Exercise, ExerciseLog, Routine, WorkoutSession } from '@/lib/types'
import { formatDate, formatKg, progressionRecommendation, todayLocalISO } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'

type ActiveSession = WorkoutSession & { exercise_logs: ExerciseLog[] }
type PreviousMap = Record<string, ExerciseLog | undefined>

export function WorkoutsClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [history, setHistory] = useState<WorkoutSession[]>([])
  const [previous, setPrevious] = useState<PreviousMap>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const user = await getCurrentUser(supabase)
    setUserId(user.id)
    await ensureStarterData(supabase, user.id)

    const [routineRes, exerciseRes, activeRes, historyRes] = await Promise.all([
      supabase
        .from('routines')
        .select('*, routine_exercises(*, exercises(*))')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase.from('exercises').select('*').eq('user_id', user.id).order('name'),
      supabase
        .from('workout_sessions')
        .select('*, routines(name), exercise_logs(*, exercises(name, rep_min, rep_max, increment_kg), exercise_sets(*))')
        .eq('user_id', user.id)
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('workout_sessions')
        .select('*, routines(name)')
        .eq('user_id', user.id)
        .not('completed_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(12),
    ])

    if (routineRes.error) setMessage(routineRes.error.message)
    else {
      const rs = (routineRes.data ?? []) as Routine[]
      rs.forEach((r) => r.routine_exercises?.sort((a,b) => a.position-b.position))
      setRoutines(rs)
    }
    if (exerciseRes.error) setMessage(exerciseRes.error.message)
    else setExercises((exerciseRes.data ?? []) as Exercise[])
    if (historyRes.error) setMessage(historyRes.error.message)
    else setHistory((historyRes.data ?? []) as WorkoutSession[])

    if (activeRes.error) {
      setMessage(activeRes.error.message)
      setActive(null)
      return
    }

    const current = activeRes.data as ActiveSession | null
    if (current) {
      current.exercise_logs = (current.exercise_logs ?? []).map((log) => ({
        ...log,
        exercise_sets: (log.exercise_sets ?? []).sort((a,b) => a.set_number-b.set_number),
      })).sort((a,b) => a.order_index-b.order_index)
      setActive(current)
      await loadPrevious(user.id, current)
    } else {
      setActive(null)
      setPrevious({})
    }
  }, [supabase])

  async function loadPrevious(uid: string, session: ActiveSession) {
    const exerciseIds = session.exercise_logs.map((l) => l.exercise_id)
    if (!exerciseIds.length) return setPrevious({})
    const { data } = await supabase
      .from('exercise_logs')
      .select('*, exercise_sets(*)')
      .eq('user_id', uid)
      .in('exercise_id', exerciseIds)
      .neq('session_id', session.id)
      .order('performed_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(150)

    const map: PreviousMap = {}
    ;((data ?? []) as ExerciseLog[]).forEach((log) => {
      if (!map[log.exercise_id]) map[log.exercise_id] = { ...log, exercise_sets: (log.exercise_sets ?? []).sort((a,b) => a.set_number-b.set_number) }
    })
    setPrevious(map)
  }

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(userId, ['routines', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'], load)

  async function createRoutine(name: string, exerciseIds: string[]) {
    if (!userId || !name.trim() || !exerciseIds.length) return
    setBusy(true)
    const { data: routine, error } = await supabase.from('routines').insert({
      user_id: userId,
      name: name.trim(),
      description: 'Custom routine',
    }).select().single()
    if (error || !routine) {
      setBusy(false)
      setMessage(error?.message ?? 'Could not create routine.')
      return
    }
    const selected = exerciseIds.map((id) => exercises.find((e) => e.id === id)).filter(Boolean) as Exercise[]
    const { error: itemError } = await supabase.from('routine_exercises').insert(selected.map((exercise, position) => ({
      user_id: userId,
      routine_id: routine.id,
      exercise_id: exercise.id,
      position,
      target_sets: 3,
      rep_min: exercise.rep_min,
      rep_max: exercise.rep_max,
    })))
    setBusy(false)
    if (itemError) setMessage(itemError.message)
    else {
      setMessage('Custom routine created.')
      load()
    }
  }

  async function deleteRoutine(id: string, name: string) {
    if (!confirm(`Delete routine "${name}"? Exercise history will remain.`)) return
    const { error } = await supabase.from('routines').delete().eq('id', id)
    if (error) setMessage(error.message)
    else load()
  }

  async function startRoutine(routine: Routine) {
    if (!userId || active) return
    setBusy(true)
    setMessage('')
    const { data: session, error: sessionError } = await supabase.from('workout_sessions').insert({
      user_id: userId,
      routine_id: routine.id,
      session_date: todayLocalISO(),
    }).select().single()
    if (sessionError || !session) {
      setBusy(false)
      return setMessage(sessionError?.message ?? 'Could not start workout.')
    }

    const items = routine.routine_exercises ?? []
    const { error: logsError } = await supabase.from('exercise_logs').insert(items.map((item, index) => ({
      user_id: userId,
      exercise_id: item.exercise_id,
      session_id: session.id,
      performed_on: todayLocalISO(),
      order_index: index,
    })))
    setBusy(false)
    if (logsError) setMessage(logsError.message)
    else {
      setMessage('Workout started. Every set you save is immediately stored in the cloud.')
      load()
    }
  }

  async function saveSet(log: ExerciseLog, weight: number, reps: number) {
    if (!userId) return
    const next = (log.exercise_sets?.length ?? 0) + 1
    const { error } = await supabase.from('exercise_sets').insert({
      user_id: userId,
      exercise_log_id: log.id,
      set_number: next,
      weight_kg: weight,
      reps,
    })
    if (error) setMessage(error.message)
    else load()
  }

  async function deleteSet(id: string) {
    await supabase.from('exercise_sets').delete().eq('id', id)
    load()
  }

  async function finishWorkout() {
    if (!active) return
    setBusy(true)
    const { error } = await supabase.from('workout_sessions').update({ completed_at: new Date().toISOString() }).eq('id', active.id)
    setBusy(false)
    if (error) setMessage(error.message)
    else {
      setMessage('Workout completed and saved.')
      load()
    }
  }

  async function discardWorkout() {
    if (!active || !confirm('Discard this active workout and all sets logged inside it?')) return
    await supabase.from('workout_sessions').delete().eq('id', active.id)
    load()
  }

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Gym mode</div>
        <h1 className="h1">Workouts</h1>
        <p>Start a routine, log sets as you train, and resume the same active session from another device. Saved sets go to Supabase immediately.</p>
      </header>

      {message && <div className="notice">{message}</div>}

      {active ? (
        <ActiveWorkout session={active} previous={previous} onSaveSet={saveSet} onDeleteSet={deleteSet} onFinish={finishWorkout} onDiscard={discardWorkout} busy={busy} />
      ) : (
        <>
          <section className="stack">
            <div className="row-between"><div><h2 className="h2">Choose a routine</h2><div className="muted">Your starter plan can be expanded later by adding exercises and routines in the database/UI.</div></div><span className="badge"><span className="live-dot" />Ready</span></div>
            <div className="routine-grid">
              {routines.map((routine) => (
                <div className="card stack" key={routine.id}>
                  <div className="row-between"><div><div className="eyebrow">{routine.routine_exercises?.length ?? 0} exercises</div><h2 className="h2" style={{marginTop:6}}>{routine.name}</h2><div className="muted" style={{marginTop:6}}>{routine.description}</div></div><button className="btn btn-danger" onClick={() => deleteRoutine(routine.id, routine.name)}>Delete</button></div>
                  <div className="stack" style={{gap:7}}>{routine.routine_exercises?.map((item) => <div className="card-soft" key={item.id}><strong>{item.exercises?.name}</strong><div className="muted" style={{fontSize:12,marginTop:3}}>{item.target_sets} sets · {item.rep_min}–{item.rep_max} reps</div></div>)}</div>
                  <button className="btn btn-primary" disabled={busy} onClick={() => startRoutine(routine)}>Start {routine.name}</button>
                </div>
              ))}
            </div>
          </section>
          <RoutineCreateForm exercises={exercises} onCreate={createRoutine} busy={busy} />
        </>
      )}

      <section className="card stack">
        <h2 className="h2">Completed sessions</h2>
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Routine</th><th>Status</th></tr></thead><tbody>
            {history.map((s) => <tr key={s.id}><td>{formatDate(s.session_date)}</td><td>{s.routines?.name ?? 'Custom workout'}</td><td><span className="badge badge-good">Completed</span></td></tr>)}
            {!history.length && <tr><td colSpan={3}><div className="empty">Your completed workouts will show here.</div></td></tr>}
          </tbody></table>
        </div>
      </section>
    </div>
  )
}

function RoutineCreateForm({ exercises, onCreate, busy }: { exercises: Exercise[]; onCreate: (name: string, exerciseIds: string[]) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !selected.length) return
    await onCreate(name, selected)
    setName('')
    setSelected([])
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div><h2 className="h2">Create custom routine</h2><div className="muted">Choose exercises in the order you want to perform them. New routines use 3 working sets and each exercise's saved rep range.</div></div>
      <label>Routine name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper A" /></label>
      <div className="grid grid-3">
        {exercises.map((exercise) => (
          <label key={exercise.id} className="card-soft" style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',color:'var(--text)'}}>
            <input type="checkbox" checked={selected.includes(exercise.id)} onChange={() => toggle(exercise.id)} style={{width:18,minHeight:18}} />
            <span><strong>{exercise.name}</strong><span className="muted" style={{display:'block',fontSize:11,marginTop:2}}>{exercise.rep_min}–{exercise.rep_max} reps</span></span>
          </label>
        ))}
      </div>
      <button className="btn btn-primary" disabled={busy || !selected.length}>{busy ? 'Saving…' : `Create routine (${selected.length} exercises)`}</button>
    </form>
  )
}

function ActiveWorkout({ session, previous, onSaveSet, onDeleteSet, onFinish, onDiscard, busy }: {
  session: ActiveSession
  previous: PreviousMap
  onSaveSet: (log: ExerciseLog, weight: number, reps: number) => Promise<void>
  onDeleteSet: (id: string) => Promise<void>
  onFinish: () => Promise<void>
  onDiscard: () => Promise<void>
  busy: boolean
}) {
  return (
    <section className="stack">
      <div className="card row-between">
        <div><div className="eyebrow"><span className="live-dot" />Active workout</div><h2 className="h2" style={{marginTop:7}}>{session.routines?.name ?? 'Workout'}</h2><div className="muted" style={{marginTop:4}}>{formatDate(session.session_date)} · Autosaving sets</div></div>
        <div className="row"><button className="btn btn-danger" onClick={onDiscard}>Discard</button><button className="btn btn-primary" disabled={busy} onClick={onFinish}>{busy ? 'Finishing…' : 'Finish workout'}</button></div>
      </div>

      {session.exercise_logs.map((log) => <WorkoutExercise key={log.id} log={log} previous={previous[log.exercise_id]} onSave={onSaveSet} onDelete={onDeleteSet} />)}
    </section>
  )
}

function WorkoutExercise({ log, previous, onSave, onDelete }: { log: ExerciseLog; previous?: ExerciseLog; onSave: (log: ExerciseLog, weight: number, reps: number) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const exercise = log.exercises as unknown as { name: string; rep_min: number; rep_max: number; increment_kg: number } | null
  const lastSets = previous?.exercise_sets ?? []
  const suggestedWeight = lastSets.length ? Number(lastSets[0].weight_kg) : 0
  const [weight, setWeight] = useState(suggestedWeight ? String(suggestedWeight) : '')
  const [reps, setReps] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!weight && suggestedWeight) setWeight(String(suggestedWeight))
  }, [suggestedWeight])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const w = Number(weight), r = Number(reps)
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 1) return
    setSaving(true)
    await onSave(log, w, r)
    setSaving(false)
    setReps('')
  }

  return (
    <div className="card stack">
      <div className="row-between">
        <div>
          <h2 className="h2">{exercise?.name ?? 'Exercise'}</h2>
          <div className="muted" style={{marginTop:5}}>Target {exercise?.rep_min ?? '?'}–{exercise?.rep_max ?? '?'} reps</div>
        </div>
        <span className="badge">{log.exercise_sets?.length ?? 0} sets saved</span>
      </div>

      <div className="card-soft">
        <div className="eyebrow">Last time</div>
        <div style={{marginTop:6}}>{lastSets.length ? lastSets.map((s) => `${formatKg(Number(s.weight_kg)).replace(' kg','')}×${s.reps}`).join(' · ') : 'No previous session'}</div>
        {exercise && previous && <div className="muted" style={{fontSize:12,marginTop:5}}>{progressionRecommendation(exercise, previous)}</div>}
      </div>

      {!!log.exercise_sets?.length && <div className="stack" style={{gap:7}}>{log.exercise_sets.map((set) => <div key={set.id} className="card-soft row-between"><div><strong>Set {set.set_number}</strong> · {formatKg(Number(set.weight_kg))} × {set.reps}</div><button className="btn btn-danger" onClick={() => onDelete(set.id)}>Delete</button></div>)}</div>}

      <form className="set-row" onSubmit={submit}>
        <strong>#{(log.exercise_sets?.length ?? 0) + 1}</strong>
        <label>Weight kg<input required type="number" min="0" step="0.25" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        <label>Reps<input required type="number" min="1" max="200" value={reps} onChange={(e) => setReps(e.target.value)} /></label>
        <button className="btn btn-primary set-action" disabled={saving}>{saving ? 'Saving…' : 'Save set'}</button>
      </form>
    </div>
  )
}
