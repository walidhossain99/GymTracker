import { getProgressionDecision } from './metrics'
import type { Exercise, ExerciseLog, RoutineExercise } from './types'

export type LogWithSession = ExerciseLog & {
  workout_sessions?: { routine_id: string | null; session_date: string } | null
}

export type ProgressMessageItem = {
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

export function normalizeProgressLogs(logs: LogWithSession[]) {
  return logs.map((log) => ({
    ...log,
    exercise_sets: [...(log.exercise_sets ?? [])].sort((a, b) => a.set_number - b.set_number),
  }))
}

export function buildProgressMessages(
  exercises: Exercise[],
  routineItems: RoutineExercise[],
  rawLogs: LogWithSession[]
): ProgressMessageItem[] {
  const logs = normalizeProgressLogs(rawLogs)
  const latestWithSets = new Map<string, LogWithSession>()

  for (const log of logs) {
    if ((log.exercise_sets?.length ?? 0) === 0) continue
    if (!latestWithSets.has(log.exercise_id)) latestWithSets.set(log.exercise_id, log)
  }

  const items: ProgressMessageItem[] = []

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

    items.push({
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

  items.sort((a, b) => {
    const readyA = a.status === 'increase' ? 1 : 0
    const readyB = b.status === 'increase' ? 1 : 0
    if (readyA !== readyB) return readyB - readyA
    const dateOrder = b.log.performed_on.localeCompare(a.log.performed_on)
    if (dateOrder !== 0) return dateOrder
    return a.exercise.name.localeCompare(b.exercise.name)
  })

  return items
}

function hashString(input: string) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function progressMessageSignature(items: ProgressMessageItem[]) {
  if (!items.length) return ''

  const payload = items.map((item) => ({
    exerciseId: item.exercise.id,
    exerciseName: item.exercise.name,
    muscleGroup: item.exercise.muscle_group,
    logId: item.log.id,
    performedOn: item.log.performed_on,
    status: item.status,
    workingWeight: item.workingWeight,
    nextWeight: item.nextWeight,
    targetSets: item.targetSets,
    repMin: item.repMin,
    repMax: item.repMax,
    incrementKg: item.exercise.increment_kg,
    sets: [...(item.log.exercise_sets ?? [])]
      .sort((a, b) => a.set_number - b.set_number)
      .slice(0, item.targetSets)
      .map((set) => [set.set_number, Number(set.weight_kg), Number(set.reps)]),
  }))

  return `v1-${hashString(JSON.stringify(payload))}`
}
