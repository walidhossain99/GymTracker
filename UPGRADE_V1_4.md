# Progress Forge v1.4

## What changed
- Bodyweight history rows now have **Edit** and **Delete** actions.
- Editing a historical weigh-in lets you change its date, weight, optional body-fat percentage, and note.
- Saving updates the existing Supabase row instead of creating a duplicate.
- Trend metrics, deltas, averages, and charts recalculate after the edit.
- If you change a weigh-in to a date that already has an entry, the app shows a clear conflict message rather than overwriting it silently.

## Deploy
Replace these files in the existing GitHub repository:
- `components/BodyweightClient.tsx`
- `app/globals.css`

Commit to `main`. Vercel should redeploy automatically.

No Supabase SQL or schema change is required.
