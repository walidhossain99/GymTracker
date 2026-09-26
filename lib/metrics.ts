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

export function progressionRecommendation(
  exercise: { rep_min: number; rep_max: number; increment_kg: number },
  latestLog?: ExerciseLog | null
) {
  const sets = latestLog?.exercise_sets ?? []
  if (!sets.length) return 'Log your first session to receive an automatic progression recommendation.'

  const everySetAtTop = sets.every((s) => Number(s.reps) >= exercise.rep_max)
  const everySetInRange = sets.every((s) => Number(s.reps) >= exercise.rep_min)
  const topWeight = Math.max(...sets.map((s) => Number(s.weight_kg)))

  if (everySetAtTop) {
    const next = topWeight + Number(exercise.increment_kg || 0)
    return `Target cleared. Try ${formatKg(next)} next time and work back through the rep range.`
  }

  if (everySetInRange) {
    return `Keep ${formatKg(topWeight)} and try to add reps until every set reaches ${exercise.rep_max}.`
  }

  return `Keep the load steady and aim to get every working set to at least ${exercise.rep_min} reps before increasing weight.`
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
