# Progress Forge v1.6 — Progress Messages

This update adds a persistent **Messages** section for progression reminders.

## What it does

- Adds **Messages** to desktop and mobile navigation.
- Automatically scans the latest logged working sets for each exercise.
- Lists exercises that have cleared the upper rep target on every programmed set under **Increase next session**.
- Shows the cleared load, recommended next load, reps achieved, target sets and rep range.
- Also keeps a **Current-load reminders** section for exercises where you should keep the same load and add reps.
- Messages are derived from existing cloud workout history, so there is no extra notification table to maintain and no manual dismiss step. They update automatically after new sets are logged.

## Files changed / added

- `components/AppShell.tsx`
- `components/ProgressMessagesClient.tsx` (new)
- `app/(app)/messages/page.tsx` (new)
- `app/globals.css`

## Database

No Supabase SQL change is required.
