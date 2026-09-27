# Progress Forge v1.1 update

This update does **not** require a Supabase schema change.

## What changed

1. **Existing exercises are editable**
   - Rename exercise
   - Change muscle group
   - Change minimum/maximum rep target
   - Change progression/load increment
   - Optional checkbox to apply the new rep range to every routine using that exercise
   - Exercise history is preserved

2. **Workout routines are editable**
   - Rename routine
   - Edit description
   - Add exercises from the exercise library
   - Remove exercises
   - Reorder exercises with Up/Down controls
   - Set working-set count per exercise
   - Set routine-specific rep minimum and maximum
   - Active workout now displays the routine-specific target sets and rep range

3. **Decimal weight-entry bug fixed**
   - Bodyweight now accepts 0.01 kg precision (examples: 75.5, 75.55, 92.01)
   - Body-fat input accepts 0.01% precision
   - Weight changes display up to two decimal places
   - Exercise/load inputs also accept 0.01 kg precision

## Update an existing GitHub deployment

Replace these four files in the repository with the v1.1 versions:

- `components/ExercisesClient.tsx`
- `components/WorkoutsClient.tsx`
- `components/BodyweightClient.tsx`
- `app/globals.css`

Commit directly to `main`. Vercel should automatically build and redeploy.

No SQL needs to be run in Supabase for this update.
