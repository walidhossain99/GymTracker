# Progress Forge v1.2 upgrade

This update changes only the frontend. No Supabase schema changes are required and existing workout data is preserved.

## What changed

1. **Manual workout date**
   - Choose the workout date before starting any routine.
   - While a workout is active, change the date and click **Save date**.
   - Changing an active workout date updates both `workout_sessions.session_date` and every exercise log inside that session (`exercise_logs.performed_on`).

2. **Focused routine editing**
   - Clicking **Edit** now opens only the selected routine.
   - Other workout-day cards are hidden until you save/cancel/back out.

3. **Drag-and-drop exercise order**
   - Grab the `⋮⋮` handle and drag an exercise above/below another exercise.
   - The existing **↑ / ↓** buttons remain available as a reliable fallback (including touch devices).
   - Click **Save routine changes** after reordering.

## Files to replace in GitHub

Replace these two files with the versions in this patch:

- `components/WorkoutsClient.tsx`
- `app/globals.css`

Commit directly to `main`. Vercel should redeploy automatically.

## Supabase

Do **not** rerun `schema.sql` and do not delete/reset the database. The current schema already supports editable session dates.
