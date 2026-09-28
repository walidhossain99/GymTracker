'use client'

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import { ensureStarterData } from '@/lib/seed'
import type { Exercise, ExerciseLog, ExerciseSet, Routine, RoutineExercise, WorkoutSession } from '@/lib/types'
import { formatDate, formatKg, getProgressionDecision, progressionRecommendation, todayLocalISO } from '@/lib/metrics'
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
  const [workoutDate, setWorkoutDate] = useState(todayLocalISO())

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

  async function startRoutine(routine: Routine, sessionDate: string) {
    if (!userId || active || !sessionDate) return
    setBusy(true)
    setMessage('')
    const { data: session, error: sessionError } = await supabase.from('workout_sessions').insert({
      user_id: userId,
      routine_id: routine.id,
      session_date: sessionDate,
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
      performed_on: sessionDate,
      order_index: index,
    })))
    setBusy(false)
    if (logsError) setMessage(logsError.message)
    else {
      setMessage(`Workout started for ${formatDate(sessionDate)}. Every set you save is immediately stored in the cloud.`)
      load()
    }
  }

  async function updateActiveWorkoutDate(sessionDate: string) {
    if (!userId || !active || !sessionDate || sessionDate === active.session_date) return
    setBusy(true)
    setMessage('')

    const { error: sessionError } = await supabase
      .from('workout_sessions')
      .update({ session_date: sessionDate })
      .eq('id', active.id)
      .eq('user_id', userId)

    if (sessionError) {
      setBusy(false)
      setMessage(sessionError.message)
      return
    }

    const { error: logsError } = await supabase
      .from('exercise_logs')
      .update({ performed_on: sessionDate })
      .eq('session_id', active.id)
      .eq('user_id', userId)

    setBusy(false)
    if (logsError) setMessage(logsError.message)
    else {
      setWorkoutDate(sessionDate)
      setMessage(`Workout date changed to ${formatDate(sessionDate)}.`)
      await load()
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

  async function updateSet(id: string, weight: number, reps: number) {
    if (!userId) return
    if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(reps) || reps < 1 || reps > 200) {
      setMessage('Enter a valid weight and rep count.')
      return
    }

    const { error } = await supabase
      .from('exercise_sets')
      .update({ weight_kg: weight, reps })
      .eq('id', id)
      .eq('user_id', userId)

    if (error) setMessage(error.message)
    else {
      setMessage('Set corrected and saved.')
      await load()
    }
  }

  async function deleteSet(id: string) {
    if (!userId) return
    const { error } = await supabase.from('exercise_sets').delete().eq('id', id).eq('user_id', userId)
    if (error) setMessage(error.message)
    else await load()
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
  const editingRoutine = editingRoutineId ? routines.find((routine) => routine.id === editingRoutineId) ?? null : null

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Gym mode</div>
        <h1 className="h1">Workouts</h1>
        <p>Build each training day exactly how you want it, then log sets as you train and resume the same active session from another device.</p>
      </header>

      {message && <div className="notice">{message}</div>}

      {active ? (
        <ActiveWorkout
          session={active}
          routine={activeRoutine}
          previous={previous}
          onSaveSet={saveSet}
          onUpdateSet={updateSet}
          onDeleteSet={deleteSet}
          onUpdateDate={updateActiveWorkoutDate}
          onFinish={finishWorkout}
          onDiscard={discardWorkout}
          busy={busy}
        />
      ) : editingRoutine ? (
        <section className="stack routine-edit-focus">
          <div className="row-between">
            <div>
              <div className="eyebrow">Editing workout day</div>
              <h2 className="h2" style={{marginTop:6}}>{editingRoutine.name}</h2>
              <div className="muted" style={{marginTop:5}}>Only this routine is shown while editing so you can focus on its exercise order, sets and rep ranges.</div>
            </div>
            <button type="button" className="btn" onClick={() => setEditingRoutineId(null)}>← Back to routines</button>
          </div>
          <RoutineEditForm routine={editingRoutine} exercises={exercises} onSave={updateRoutine} onCancel={() => setEditingRoutineId(null)} busy={busy} />
        </section>
      ) : (
        <>
          <section className="stack">
            <div className="row-between">
              <div><h2 className="h2">Choose a routine</h2><div className="muted">Every workout day is editable. Add or remove exercises, change order, sets and rep ranges whenever your plan changes.</div></div>
              <div className="routine-start-date">
                <label>Workout date<input type="date" value={workoutDate} onChange={(e) => setWorkoutDate(e.target.value)} /></label>
                <span className="badge"><span className="live-dot" />Ready</span>
              </div>
            </div>
            <div className="routine-grid">
              {routines.map((routine) => (
                <div className="card stack" key={routine.id}>
                  <div className="row-between">
                    <div><div className="eyebrow">{routine.routine_exercises?.length ?? 0} exercises</div><h2 className="h2" style={{marginTop:6}}>{routine.name}</h2><div className="muted" style={{marginTop:6}}>{routine.description}</div></div>
                    <div className="row"><button className="btn" onClick={() => setEditingRoutineId(routine.id)}>Edit</button><button className="btn btn-danger" onClick={() => deleteRoutine(routine.id, routine.name)}>Delete</button></div>
                  </div>
                  <div className="stack" style={{gap:7}}>{routine.routine_exercises?.map((item) => <div className="card-soft" key={item.id}><strong>{item.exercises?.name}</strong><div className="muted" style={{fontSize:12,marginTop:3}}>{item.target_sets} sets · {item.rep_min}–{item.rep_max} reps</div></div>)}</div>
                  <button className="btn btn-primary" disabled={busy || !workoutDate} onClick={() => startRoutine(routine, workoutDate)}>Start {routine.name}</button>
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
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)

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

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
    setItems((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function beginPointerDrag(e: ReactPointerEvent<HTMLSpanElement>, index: number) {
    dragIndexRef.current = index
    setDraggingIndex(index)
    setDragOverIndex(index)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }

  function continuePointerDrag(e: ReactPointerEvent<HTMLSpanElement>) {
    const from = dragIndexRef.current
    if (from === null) return
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-routine-index]')
    const to = target ? Number(target.dataset.routineIndex) : Number.NaN
    if (!Number.isInteger(to) || to < 0 || to >= items.length || to === from) return
    reorder(from, to)
    dragIndexRef.current = to
    setDraggingIndex(to)
    setDragOverIndex(to)
    e.preventDefault()
  }

  function endPointerDrag(e: ReactPointerEvent<HTMLSpanElement>) {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragIndexRef.current = null
    setDraggingIndex(null)
    setDragOverIndex(null)
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
            <div
              className={`card-soft stack routine-sort-item ${dragOverIndex === index ? 'drag-over' : ''} ${draggingIndex === index ? 'dragging' : ''}`}
              key={item.exercise_id}
              style={{gap:10}}
              data-routine-index={index}
            >
              <div className="row-between">
                <div className="routine-sort-title">
                  <span
                    className="drag-handle"
                    role="button"
                    tabIndex={0}
                    title="Drag to reorder"
                    aria-label={`Drag ${exercise?.name ?? 'exercise'} to reorder`}
                    onPointerDown={(e) => beginPointerDrag(e, index)}
                    onPointerMove={continuePointerDrag}
                    onPointerUp={endPointerDrag}
                    onPointerCancel={endPointerDrag}
                  >⋮⋮</span>
                  <div><strong>{index + 1}. {exercise?.name ?? 'Exercise'}</strong><div className="muted" style={{fontSize:11,marginTop:2}}>{exercise?.muscle_group || 'Uncategorized'}</div></div>
                </div>
                <div className="row">
                  <button type="button" className="btn" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move exercise up">↑</button>
                  <button type="button" className="btn" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label="Move exercise down">↓</button>
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

function ActiveWorkout({ session, routine, previous, onSaveSet, onUpdateSet, onDeleteSet, onUpdateDate, onFinish, onDiscard, busy }: {
  session: ActiveSession
  routine: Routine | null
  previous: PreviousMap
  onSaveSet: (log: ExerciseLog, weight: number, reps: number) => Promise<void>
  onUpdateSet: (id: string, weight: number, reps: number) => Promise<void>
  onDeleteSet: (id: string) => Promise<void>
  onUpdateDate: (date: string) => Promise<void>
  onFinish: () => Promise<void>
  onDiscard: () => Promise<void>
  busy: boolean
}) {
  const [dateDraft, setDateDraft] = useState(session.session_date)

  useEffect(() => {
    setDateDraft(session.session_date)
  }, [session.session_date])

  return (
    <section className="stack">
      <div className="card active-workout-header">
        <div>
          <div className="eyebrow"><span className="live-dot" />Active workout</div>
          <h2 className="h2" style={{marginTop:7}}>{session.routines?.name ?? 'Workout'}</h2>
          <div className="muted" style={{marginTop:4}}>Autosaving sets to the cloud</div>
        </div>
        <div className="active-date-editor">
          <label>Workout date<input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} /></label>
          <button type="button" className="btn" disabled={busy || !dateDraft || dateDraft === session.session_date} onClick={() => onUpdateDate(dateDraft)}>Save date</button>
        </div>
        <div className="row active-workout-actions"><button className="btn btn-danger" onClick={onDiscard}>Discard</button><button className="btn btn-primary" disabled={busy} onClick={onFinish}>{busy ? 'Finishing…' : 'Finish workout'}</button></div>
      </div>

      {session.exercise_logs.map((log) => {
        const target = routine?.routine_exercises?.find((item) => item.exercise_id === log.exercise_id)
        return <WorkoutExercise key={log.id} log={log} target={target} previous={previous[log.exercise_id]} onSave={onSaveSet} onUpdate={onUpdateSet} onDelete={onDeleteSet} />
      })}
    </section>
  )
}

function WorkoutExercise({ log, target, previous, onSave, onUpdate, onDelete }: {
  log: ExerciseLog
  target?: RoutineExercise
  previous?: ExerciseLog
  onSave: (log: ExerciseLog, weight: number, reps: number) => Promise<void>
  onUpdate: (id: string, weight: number, reps: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const exercise = log.exercises as unknown as { name: string; rep_min: number; rep_max: number; increment_kg: number } | null
  const repMin = target?.rep_min ?? exercise?.rep_min ?? 1
  const repMax = target?.rep_max ?? exercise?.rep_max ?? repMin
  const targetSets = target?.target_sets ?? 3
  const progressionSettings = { rep_min: repMin, rep_max: repMax, increment_kg: exercise?.increment_kg ?? 0 }
  const lastSets = previous?.exercise_sets ?? []
  const previousDecision = getProgressionDecision(progressionSettings, previous, targetSets)
  const suggestedWeight = previousDecision.status === 'increase' && previousDecision.nextWeight !== null
    ? previousDecision.nextWeight
    : (lastSets.length ? Number(lastSets[0].weight_kg) : 0)
  const currentDecision = getProgressionDecision(progressionSettings, log, targetSets)
  const progressionWasCleared = useRef(currentDecision.status === 'increase')
  const [progressionPop, setProgressionPop] = useState(false)
  const [weight, setWeight] = useState(suggestedWeight ? String(suggestedWeight) : '')
  const [reps, setReps] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!weight && suggestedWeight) setWeight(String(suggestedWeight))
  }, [suggestedWeight, weight])

  useEffect(() => {
    const clearedNow = currentDecision.status === 'increase'
    if (clearedNow && !progressionWasCleared.current) setProgressionPop(true)
    progressionWasCleared.current = clearedNow
  }, [currentDecision.status])

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
          <div className="muted" style={{marginTop:5}}>Target {targetSets} sets · {repMin}–{repMax} reps</div>
        </div>
        <span className="badge">{log.exercise_sets?.length ?? 0}/{targetSets} sets saved</span>
      </div>

      <div className="card-soft">
        <div className="eyebrow">Last time</div>
        <div style={{marginTop:6}}>{lastSets.length ? lastSets.map((s) => `${formatKg(Number(s.weight_kg)).replace(' kg','')}×${s.reps}`).join(' · ') : 'No previous session'}</div>
        {previous && <div className={`progression-guidance ${previousDecision.status === 'increase' ? 'progression-guidance-ready' : ''}`} style={{fontSize:12,marginTop:7}}>{progressionRecommendation(progressionSettings, previous, targetSets)}</div>}
      </div>

      {currentDecision.status === 'increase' && (
        <div className="progression-ready-card">
          <div>
            <div className="eyebrow">Progression unlocked</div>
            <strong>Increase next session</strong>
            <div className="muted" style={{marginTop:4}}>{currentDecision.message}</div>
          </div>
          {currentDecision.nextWeight !== null && currentDecision.incrementKg > 0 && (
            <div className="progression-next-load">{formatKg(currentDecision.nextWeight)}</div>
          )}
        </div>
      )}

      {!!log.exercise_sets?.length && (
        <div className="stack" style={{gap:7}}>
          {log.exercise_sets.map((set) => (
            <EditableWorkoutSet key={set.id} set={set} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      )}

      <form className="set-row" onSubmit={submit}>
        <strong>#{(log.exercise_sets?.length ?? 0) + 1}</strong>
        <label>Weight kg<input required type="number" min="0" step="0.01" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        <label>Reps<input required type="number" min="1" max="200" value={reps} onChange={(e) => setReps(e.target.value)} /></label>
        <button className="btn btn-primary set-action" disabled={saving}>{saving ? 'Saving…' : 'Save set'}</button>
      </form>

      {progressionPop && (
        <div className="progression-modal-backdrop" role="presentation" onMouseDown={() => setProgressionPop(false)}>
          <div className="progression-modal" role="dialog" aria-modal="true" aria-labelledby={`progression-${log.id}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="progression-pop-icon">↑</div>
            <div className="eyebrow">Progression unlocked</div>
            <h3 id={`progression-${log.id}`}>{exercise?.name ?? 'Exercise'} — increase next session</h3>
            <p>
              You hit at least <strong>{repMax} reps</strong> on all <strong>{targetSets} working sets</strong>
              {currentDecision.workingWeight !== null ? <> at <strong>{formatKg(currentDecision.workingWeight)}</strong></> : null}.
            </p>
            {currentDecision.nextWeight !== null && currentDecision.incrementKg > 0 ? (
              <div className="progression-pop-load">
                <span>Next working weight</span>
                <strong>{formatKg(currentDecision.nextWeight)}</strong>
                <small>+{formatKg(currentDecision.incrementKg)}</small>
              </div>
            ) : (
              <div className="notice">Target cleared. Add a load-increase value in Exercise settings so the app can calculate the next weight.</div>
            )}
            <p className="muted">Next time, move the load up and work back through the {repMin}–{repMax} rep range.</p>
            <button type="button" className="btn btn-primary" onClick={() => setProgressionPop(false)}>Got it</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditableWorkoutSet({ set, onUpdate, onDelete }: {
  set: ExerciseSet
  onUpdate: (id: string, weight: number, reps: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [weight, setWeight] = useState(String(Number(set.weight_kg)))
  const [reps, setReps] = useState(String(set.reps))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) {
      setWeight(String(Number(set.weight_kg)))
      setReps(String(set.reps))
    }
  }, [set.weight_kg, set.reps, editing])

  function cancel() {
    setWeight(String(Number(set.weight_kg)))
    setReps(String(set.reps))
    setEditing(false)
  }

  async function save() {
    const w = Number(weight)
    const r = Number(reps)
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 1 || r > 200) return
    setSaving(true)
    await onUpdate(set.id, w, r)
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="card-soft row-between saved-set-row">
        <div><strong>Set {set.set_number}</strong> · {formatKg(Number(set.weight_kg))} × {set.reps}</div>
        <div className="row saved-set-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn btn-danger" onClick={() => onDelete(set.id)}>Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card-soft saved-set-edit">
      <strong>Set {set.set_number}</strong>
      <label>
        Weight kg
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      <label>
        Reps
        <input
          type="number"
          min="1"
          max="200"
          step="1"
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
        />
      </label>
      <div className="row saved-set-actions">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" disabled={saving} onClick={cancel}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={saving} onClick={() => onDelete(set.id)}>Delete</button>
      </div>
    </div>
  )
}

