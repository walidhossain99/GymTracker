# Progress Forge v1.9 — Dashboard progression notifications

This update adds a simple, stable notification section to the existing Dashboard instead of bringing back the separate Messages route.

## Replace these files

- `components/DashboardClient.tsx`
- `app/globals.css`

No Supabase migration is required.

## Behavior

The Dashboard now shows **Progression notifications** for exercises whose latest logged working sets:

1. completed the programmed number of sets,
2. used one consistent working weight, and
3. reached the upper rep target on every required set.

Each notification shows the cleared load, rep result, and the next-session load calculated from the exercise's progression increment.

Once a newer session is logged for that exercise at the new load, the old notification automatically stops being a pending load increase.
