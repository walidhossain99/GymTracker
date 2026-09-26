import type { SupabaseClient } from '@supabase/supabase-js'

const starterExercises = [
  ['Incline Dumbbell Press', 'Chest', 6, 8, 2.5],
  ['Chest Press', 'Chest', 8, 12, 2.5],
  ['Lateral Raise', 'Shoulders', 10, 15, 1],
  ['Triceps Pushdown', 'Triceps', 8, 12, 2.5],
  ['Overhead Triceps Extension', 'Triceps', 8, 12, 2.5],
  ['Lat Pulldown', 'Back', 8, 12, 2.5],
  ['Lat Pushdown', 'Back', 10, 15, 2.5],
  ['Seated Cable Row', 'Back', 8, 12, 2.5],
  ['Rear Delt Fly', 'Rear delts', 10, 15, 1],
  ['Hammer Curl', 'Biceps', 8, 12, 1],
  ['Concentration Curl', 'Biceps', 8, 12, 1],
  ['Leg Press', 'Legs', 8, 12, 5],
  ['Romanian Deadlift', 'Hamstrings', 6, 10, 2.5],
  ['Leg Curl', 'Hamstrings', 8, 12, 2.5],
  ['Calf Raise', 'Calves', 10, 15, 5],
] as const

export async function ensureStarterData(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from('exercises')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((count ?? 0) > 0) return

  const { data: exercises, error: exerciseError } = await supabase
    .from('exercises')
    .insert(
      starterExercises.map(([name, muscle_group, rep_min, rep_max, increment_kg]) => ({
        user_id: userId,
        name,
        muscle_group,
        rep_min,
        rep_max,
        increment_kg,
      }))
    )
    .select()

  if (exerciseError || !exercises) throw exerciseError ?? new Error('Could not create starter exercises')

  const byName = new Map(exercises.map((e) => [e.name, e]))
  const routines = [
    {
      name: 'Chest · Shoulders · Triceps',
      description: 'Push-focused training day',
      exercises: ['Incline Dumbbell Press', 'Chest Press', 'Lateral Raise', 'Triceps Pushdown', 'Overhead Triceps Extension'],
    },
    {
      name: 'Back · Rear Delt · Biceps',
      description: 'Pull-focused training day',
      exercises: ['Lat Pulldown', 'Lat Pushdown', 'Seated Cable Row', 'Rear Delt Fly', 'Hammer Curl', 'Concentration Curl'],
    },
    {
      name: 'Legs',
      description: 'Lower-body training day',
      exercises: ['Leg Press', 'Romanian Deadlift', 'Leg Curl', 'Calf Raise'],
    },
  ]

  for (const routine of routines) {
    const { data: insertedRoutine, error: routineError } = await supabase
      .from('routines')
      .insert({ user_id: userId, name: routine.name, description: routine.description })
      .select()
      .single()

    if (routineError || !insertedRoutine) throw routineError ?? new Error('Could not create starter routine')

    const rows = routine.exercises.flatMap((name, position) => {
      const exercise = byName.get(name)
      if (!exercise) return []
      return [{
        user_id: userId,
        routine_id: insertedRoutine.id,
        exercise_id: exercise.id,
        position,
        target_sets: 3,
        rep_min: exercise.rep_min,
        rep_max: exercise.rep_max,
      }]
    })

    if (rows.length) await supabase.from('routine_exercises').insert(rows)
  }
}
