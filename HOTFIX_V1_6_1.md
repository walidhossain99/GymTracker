# Progress Forge v1.6.1 hotfix

This fixes the Vercel errors caused by v1.5/v1.6 files being uploaded into the repository root instead of their required folders, and ensures all progression-message dependencies are the matching version.

## IMPORTANT: delete misplaced root files first

At the TOP LEVEL of the GitHub repository, delete these files if they exist there:

- `metrics.ts`
- `types.ts`
- `WorkoutsClient.tsx`
- `ProgressMessagesClient.tsx`
- `AppShell.tsx`
- `page.tsx`
- `useRealtimeRefresh.ts`
- `globals.css`

Only delete those names when they are sitting next to `package.json` at the repository root. Do NOT delete the correctly located copies inside `lib/`, `components/`, `hooks/`, or `app/`.

## Required final paths

Replace/add the files from this hotfix so the repository contains exactly these paths:

- `components/WorkoutsClient.tsx`
- `components/ProgressMessagesClient.tsx`
- `components/AppShell.tsx`
- `lib/metrics.ts`
- `lib/types.ts`
- `hooks/useRealtimeRefresh.ts`
- `app/(app)/messages/page.tsx`
- `app/globals.css`

The root of the repo should NOT contain `metrics.ts`, `WorkoutsClient.tsx`, `ProgressMessagesClient.tsx`, or `page.tsx`.

No Supabase SQL or environment-variable changes are required.
