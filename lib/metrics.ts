import type { ExerciseLog, ExerciseSet } from './types'

export function epley1RM(weightKg: number, reps: number) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps <= 0) return 0
  return weightKg * (1 + reps / 30)
}

export function bestEstimated1RM(sets: Pick<ExerciseSet, 'weight_kg' | 'reps'>[] = []) {
  return Math.max(0, ...sets.map((s) => epley1RM(Number(s.weight_kg), Number(s.reps))))
}

export function sessionVolume(sets: Pick<ExerciseSet, 'weight_kg' | 'reps'>[] = []) {
  return sets.reduce((total, s) => total + Number(s.weight_kg) * Number(s.reps), 0)
}

export type ProgressionDecision = {
  status: 'no-data' | 'incomplete' | 'increase' | 'add-reps' | 'below-range' | 'mixed-load'
  message: string
  completedSets: number
  targetSets: number
  workingWeight: number | null
  nextWeight: number | null
  incrementKg: number
}

/**
 * Double-progression rule used by the workout logger.
 *
 * A load increase is earned only when ALL programmed working sets:
 * 1) have been completed,
 * 2) used the same load, and
 * 3) reached the upper rep target.
 *
 * Extra sets beyond targetSets are ignored for the progression decision.
 */
export function getProgressionDecision(
  exercise: { rep_min: number; rep_max: number; increment_kg: number },
  latestLog?: ExerciseLog | null,
  targetSets?: number
): ProgressionDecision {
  const sorted = [...(latestLog?.exercise_sets ?? [])].sort((a, b) => a.set_number - b.set_number)
  const requiredSets = Math.max(1, Math.trunc(targetSets ?? (sorted.length || 1)))
  const workingSets = sorted.slice(0, requiredSets)
  const incrementKg = Number(exercise.increment_kg || 0)

  if (!sorted.length) {
    return {
      status: 'no-data',
      message: 'Log your first session to receive an automatic progression recommendation.',
      completedSets: 0,
      targetSets: requiredSets,
      workingWeight: null,
      nextWeight: null,
      incrementKg,
    }
  }

  const firstWeight = Number(workingSets[0]?.weight_kg ?? 0)
  const sameLoad = workingSets.length > 0 && workingSets.every((set) => Math.abs(Number(set.weight_kg) - firstWeight) < 0.001)

  if (workingSets.length < requiredSets) {
    return {
      status: 'incomplete',
      message: `Complete all ${requiredSets} working sets before the app decides whether to increase the load.`,
      completedSets: workingSets.length,
      targetSets: requiredSets,
      workingWeight: sameLoad ? firstWeight : null,
      nextWeight: null,
      incrementKg,
    }
  }

  if (!sameLoad) {
    return {
      status: 'mixed-load',
      message: 'Your working sets used different loads. Use one working weight across the programmed sets for an automatic double-progression increase.',
      completedSets: workingSets.length,
      targetSets: requiredSets,
      workingWeight: null,
      nextWeight: null,
      incrementKg,
    }
  }

  const everySetAtTop = workingSets.every((set) => Number(set.reps) >= exercise.rep_max)
  const everySetInRange = workingSets.every((set) => Number(set.reps) >= exercise.rep_min)

  if (everySetAtTop) {
    const nextWeight = firstWeight + incrementKg
    return {
      status: 'increase',
      message: incrementKg > 0
        ? `Target cleared. Next session increase from ${formatKg(firstWeight)} to ${formatKg(nextWeight)} (+${formatKg(incrementKg)}). Start again near the bottom of the ${exercise.rep_min}–${exercise.rep_max} rep range.`
        : `Target cleared at ${formatKg(firstWeight)}. Set a progression step for this exercise so the app can calculate your next load.`,
      completedSets: workingSets.length,
      targetSets: requiredSets,
      workingWeight: firstWeight,
      nextWeight: incrementKg > 0 ? nextWeight : firstWeight,
      incrementKg,
    }
  }

  if (everySetInRange) {
    return {
      status: 'add-reps',
      message: `Keep ${formatKg(firstWeight)} next session and add reps until all ${requiredSets} sets reach ${exercise.rep_max}.`,
      completedSets: workingSets.length,
      targetSets: requiredSets,
      workingWeight: firstWeight,
      nextWeight: firstWeight,
      incrementKg,
    }
  }

  return {
    status: 'below-range',
    message: `Keep ${formatKg(firstWeight)} and aim to get every working set to at least ${exercise.rep_min} reps before increasing weight.`,
    completedSets: workingSets.length,
    targetSets: requiredSets,
    workingWeight: firstWeight,
    nextWeight: firstWeight,
    incrementKg,
  }
}

export function progressionRecommendation(
  exercise: { rep_min: number; rep_max: number; increment_kg: number },
  latestLog?: ExerciseLog | null,
  targetSets?: number
) {
  return getProgressionDecision(exercise, latestLog, targetSets).message
}

export function formatKg(value: number) {
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`
}

export function formatDate(date: string) {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(y, m - 1, d)
  )
}

export function todayLocalISO() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
