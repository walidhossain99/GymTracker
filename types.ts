export type BodyweightEntry = {
  id: string
  user_id: string
  entry_date: string
  weight_kg: number
  body_fat_pct: number | null
  note: string | null
  created_at: string
}

export type Exercise = {
  id: string
  user_id: string
  name: string
  muscle_group: string | null
  rep_min: number
  rep_max: number
  increment_kg: number
  created_at: string
}

export type ExerciseSet = {
  id: string
  user_id: string
  exercise_log_id: string
  set_number: number
  weight_kg: number
  reps: number
  created_at: string
}

export type ExerciseLog = {
  id: string
  user_id: string
  exercise_id: string
  session_id: string | null
  performed_on: string
  order_index: number
  note: string | null
  created_at: string
  exercise_sets?: ExerciseSet[]
  exercises?: { name: string } | null
}

export type RoutineExercise = {
  id: string
  user_id: string
  routine_id: string
  exercise_id: string
  position: number
  target_sets: number
  rep_min: number
  rep_max: number
  exercises?: Exercise | null
}

export type Routine = {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
  routine_exercises?: RoutineExercise[]
}

export type WorkoutSession = {
  id: string
  user_id: string
  routine_id: string | null
  session_date: string
  started_at: string
  completed_at: string | null
  note: string | null
  routines?: { name: string } | null
  exercise_logs?: ExerciseLog[]
}
