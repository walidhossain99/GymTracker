'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import { ensureStarterData } from '@/lib/seed'
import type { Exercise, ExerciseLog, Routine, RoutineExercise, WorkoutSession } from '@/lib/types'
import { formatDate, formatKg, progressionRecommendation, todayLocalISO } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'

type ActiveSession = WorkoutSession & { exercise_logs: ExerciseLog[] }
type PreviousMap = Record<string, ExerciseLog | undefined>
type RoutineDraftItem = { exercise_id: string; target_sets: number; rep_min: number; rep_max: number }

export function WorkoutsClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [history, setHistory] = useState<WorkoutSession[]>([])
  const [previous, setPrevious] = useState<PreviousMap>({})
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null)
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
  useRealtimeRefresh(userId, ['exercises', 'routines', 'routine_exercises', 'workout_sessions', 'exercise_logs', 'exercise_sets'], load)

  async function createRoutine(name: string, exerciseIds: string[]) {
    if (!userId || !name.trim() || !exerciseIds.length) return
    setBusy(true)
    setMessage('')
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
      setMessage('Custom routine created. Use Edit routine to fine-tune sets, reps and exercise order.')
      load()
    }
  }

  async function updateRoutine(routine: Routine, name: string, description: string, items: RoutineDraftItem[]) {
    if (!userId || !name.trim() || !items.length) return
    setBusy(true)
    setMessage('')

    const { error: routineError } = await supabase.from('routines').update({
      name: name.trim(),
      description: description.trim() || null,
    }).eq('id', routine.id).eq('user_id', userId)

    if (routineError) {
      setBusy(false)
      setMessage(routineError.message)
      return
    }

    const existing = routine.routine_exercises ?? []
    const incomingIds = new Set(items.map((item) => item.exercise_id))
    const removedIds = existing.filter((item) => !incomingIds.has(item.exercise_id)).map((item) => item.id)

    if (removedIds.length) {
      const { error } = await supabase.from('routine_exercises').delete().in('id', removedIds).eq('user_id', userId)
      if (error) {
        setBusy(false)
        setMessage(error.message)
        return
      }
    }

    for (let position = 0; position < items.length; position += 1) {
      const item = items[position]
      const old = existing.find((entry) => entry.exercise_id === item.exercise_id)
      if (old) {
        const { error } = await supabase.from('routine_exercises').update({
          position,
          target_sets: item.target_sets,
          rep_min: item.rep_min,
          rep_max: item.rep_max,
        }).eq('id', old.id).eq('user_id', userId)
        if (error) {
          setBusy(false)
          setMessage(error.message)
          return
        }
      } else {
        const { error } = await supabase.from('routine_exercises').insert({
          user_id: userId,
          routine_id: routine.id,
          exercise_id: item.exercise_id,
          position,
          target_sets: item.target_sets,
          rep_min: item.rep_min,
          rep_max: item.rep_max,
        })
        if (error) {
          setBusy(false)
          setMessage(error.message)
          return
        }
      }
    }

    setBusy(false)
    setEditingRoutineId(null)
    setMessage(`${name.trim()} updated.`)
    await load()
  }

  async function deleteRoutine(id: string, name: string) {
    if (!confirm(`Delete routine "${name}"? Exercise history will remain.`)) return
    const { error } = await supabase.from('routines').delete().eq('id', id)
    if (error) setMessage(error.message)
    else {
      if (editingRoutineId === id) setEditingRoutineId(null)
      load()
    }
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

  const activeRoutine = active?.routine_id ? routines.find((routine) => routine.id === active.routine_id) ?? null : null

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Gym mode</div>
        <h1 className="h1">Workouts</h1>
        <p>Build each training day exactly how you want it, then log sets as you train and resume the same active session from another device.</p>
      </header>

      {message && <div className="notice">{message}</div>}

      {active ? (
        <ActiveWorkout session={active} routine={activeRoutine} previous={previous} onSaveSet={saveSet} onDeleteSet={deleteSet} onFinish={finishWorkout} onDiscard={discardWorkout} busy={busy} />
      ) : (
        <>
          <section className="stack">
            <div className="row-between"><div><h2 className="h2">Choose a routine</h2><div className="muted">Every workout day is editable. Add or remove exercises, change order, sets and rep ranges whenever your plan changes.</div></div><span className="badge"><span className="live-dot" />Ready</span></div>
            <div className="routine-grid">
              {routines.map((routine) => (
                <div className="card stack" key={routine.id}>
                  <div className="row-between">
                    <div><div className="eyebrow">{routine.routine_exercises?.length ?? 0} exercises</div><h2 className="h2" style={{marginTop:6}}>{routine.name}</h2><div className="muted" style={{marginTop:6}}>{routine.description}</div></div>
                    <div className="row"><button className="btn" onClick={() => setEditingRoutineId(editingRoutineId === routine.id ? null : routine.id)}>{editingRoutineId === routine.id ? 'Close' : 'Edit'}</button><button className="btn btn-danger" onClick={() => deleteRoutine(routine.id, routine.name)}>Delete</button></div>
                  </div>
                  <div className="stack" style={{gap:7}}>{routine.routine_exercises?.map((item) => <div className="card-soft" key={item.id}><strong>{item.exercises?.name}</strong><div className="muted" style={{fontSize:12,marginTop:3}}>{item.target_sets} sets · {item.rep_min}–{item.rep_max} reps</div></div>)}</div>
                  {editingRoutineId === routine.id ? (
                    <RoutineEditForm routine={routine} exercises={exercises} onSave={updateRoutine} onCancel={() => setEditingRoutineId(null)} busy={busy} />
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => startRoutine(routine)}>Start {routine.name}</button>
                  )}
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
      <div><h2 className="h2">Create custom routine</h2><div className="muted">Choose exercises in the order you want to perform them. You can edit the exact sets, reps and order immediately afterward.</div></div>
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

function RoutineEditForm({ routine, exercises, onSave, onCancel, busy }: {
  routine: Routine
  exercises: Exercise[]
  onSave: (routine: Routine, name: string, description: string, items: RoutineDraftItem[]) => Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  const [name, setName] = useState(routine.name)
  const [description, setDescription] = useState(routine.description ?? '')
  const [items, setItems] = useState<RoutineDraftItem[]>(() => (routine.routine_exercises ?? []).map((item) => ({
    exercise_id: item.exercise_id,
    target_sets: item.target_sets,
    rep_min: item.rep_min,
    rep_max: item.rep_max,
  })))
  const [addId, setAddId] = useState('')

  const available = exercises.filter((exercise) => !items.some((item) => item.exercise_id === exercise.id))

  function patch(index: number, field: keyof Omit<RoutineDraftItem, 'exercise_id'>, value: number) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= items.length) return
    setItems((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function addExercise() {
    const exercise = exercises.find((item) => item.id === addId)
    if (!exercise) return
    setItems((current) => [...current, { exercise_id: exercise.id, target_sets: 3, rep_min: exercise.rep_min, rep_max: exercise.rep_max }])
    setAddId('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !items.length) return
    const invalid = items.some((item) => !Number.isInteger(item.target_sets) || item.target_sets < 1 || item.target_sets > 20 || !Number.isInteger(item.rep_min) || !Number.isInteger(item.rep_max) || item.rep_min < 1 || item.rep_max < item.rep_min)
    if (invalid) return
    await onSave(routine, name, description, items)
  }

  return (
    <form className="routine-editor stack" onSubmit={submit}>
      <div className="card-soft stack">
        <div className="row-between"><strong>Edit routine</strong><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
        <label>Routine name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Push-focused training day" /></label>
      </div>

      <div className="stack" style={{gap:8}}>
        {items.map((item, index) => {
          const exercise = exercises.find((entry) => entry.id === item.exercise_id)
          return (
            <div className="card-soft stack" key={item.exercise_id} style={{gap:10}}>
              <div className="row-between">
                <div><strong>{index + 1}. {exercise?.name ?? 'Exercise'}</strong><div className="muted" style={{fontSize:11,marginTop:2}}>{exercise?.muscle_group || 'Uncategorized'}</div></div>
                <div className="row">
                  <button type="button" className="btn" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" className="btn" disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" className="btn btn-danger" onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>Remove</button>
                </div>
              </div>
              <div className="grid grid-3">
                <label>Working sets<input type="number" min="1" max="20" value={item.target_sets} onChange={(e) => patch(index, 'target_sets', Number(e.target.value))} /></label>
                <label>Rep min<input type="number" min="1" max="100" value={item.rep_min} onChange={(e) => patch(index, 'rep_min', Number(e.target.value))} /></label>
                <label>Rep max<input type="number" min="1" max="100" value={item.rep_max} onChange={(e) => patch(index, 'rep_max', Number(e.target.value))} /></label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card-soft stack">
        <strong>Add exercise to this day</strong>
        <div className="row">
          <select value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {available.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
          </select>
          <button type="button" className="btn" disabled={!addId} onClick={addExercise}>Add</button>
        </div>
        {!available.length && <div className="muted" style={{fontSize:12}}>Every exercise in your library is already in this routine.</div>}
      </div>

      <button className="btn btn-primary" disabled={busy || !items.length}>{busy ? 'Saving routine…' : 'Save routine changes'}</button>
    </form>
  )
}

function ActiveWorkout({ session, routine, previous, onSaveSet, onDeleteSet, onFinish, onDiscard, busy }: {
  session: ActiveSession
  routine: Routine | null
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

      {session.exercise_logs.map((log) => {
        const target = routine?.routine_exercises?.find((item) => item.exercise_id === log.exercise_id)
        return <WorkoutExercise key={log.id} log={log} target={target} previous={previous[log.exercise_id]} onSave={onSaveSet} onDelete={onDeleteSet} />
      })}
    </section>
  )
}

function WorkoutExercise({ log, target, previous, onSave, onDelete }: {
  log: ExerciseLog
  target?: RoutineExercise
  previous?: ExerciseLog
  onSave: (log: ExerciseLog, weight: number, reps: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const exercise = log.exercises as unknown as { name: string; rep_min: number; rep_max: number; increment_kg: number } | null
  const repMin = target?.rep_min ?? exercise?.rep_min ?? 1
  const repMax = target?.rep_max ?? exercise?.rep_max ?? repMin
  const targetSets = target?.target_sets ?? 3
  const lastSets = previous?.exercise_sets ?? []
  const suggestedWeight = lastSets.length ? Number(lastSets[0].weight_kg) : 0
  const [weight, setWeight] = useState(suggestedWeight ? String(suggestedWeight) : '')
  const [reps, setReps] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!weight && suggestedWeight) setWeight(String(suggestedWeight))
  }, [suggestedWeight, weight])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const w = Number(weight), r = Number(reps)
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 1) return
    setSaving(true)
    await onSave(log, w, r)
    setSaving(false)
    setReps('')
  }

  const progressionSettings = { rep_min: repMin, rep_max: repMax, increment_kg: exercise?.increment_kg ?? 0 }

  return (
    <div className="card stack">
      <div className="row-between">
        <div>
          <h2 className="h2">{exercise?.name ?? 'Exercise'}</h2>
          <div className="muted" style={{marginTop:5}}>Target {targetSets} sets · {repMin}–{repMax} reps</div>
        </div>
        <span className="badge">{log.exercise_sets?.length ?? 0}/{targetSets} sets saved</span>
      </div>

      <div className="card-soft">
        <div className="eyebrow">Last time</div>
        <div style={{marginTop:6}}>{lastSets.length ? lastSets.map((s) => `${formatKg(Number(s.weight_kg)).replace(' kg','')}×${s.reps}`).join(' · ') : 'No previous session'}</div>
        {previous && <div className="muted" style={{fontSize:12,marginTop:5}}>{progressionRecommendation(progressionSettings, previous)}</div>}
      </div>

      {!!log.exercise_sets?.length && <div className="stack" style={{gap:7}}>{log.exercise_sets.map((set) => <div key={set.id} className="card-soft row-between"><div><strong>Set {set.set_number}</strong> · {formatKg(Number(set.weight_kg))} × {set.reps}</div><button className="btn btn-danger" onClick={() => onDelete(set.id)}>Delete</button></div>)}</div>}

      <form className="set-row" onSubmit={submit}>
        <strong>#{(log.exercise_sets?.length ?? 0) + 1}</strong>
        <label>Weight kg<input required type="number" min="0" step="0.01" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        <label>Reps<input required type="number" min="1" max="200" value={reps} onChange={(e) => setReps(e.target.value)} /></label>
        <button className="btn btn-primary set-action" disabled={saving}>{saving ? 'Saving…' : 'Save set'}</button>
      </form>
    </div>
  )
}
