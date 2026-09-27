# Progress Forge v1.3 — Edit saved workout sets

This patch makes already-saved sets editable during an active workout.

## Replace these two existing files in GitHub

- `components/WorkoutsClient.tsx`
- `app/globals.css`

Commit directly to `main`. Vercel should redeploy automatically.

## What changed

Each saved set now has **Edit** and **Delete**.

Choosing **Edit** turns the saved row into editable Weight and Reps fields with **Save**, **Cancel**, and **Delete** actions. Saving updates the existing Supabase row, so the set is corrected rather than duplicated.

No Supabase SQL/schema change is required.
