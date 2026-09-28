# Progress Forge v1.8 — Remove Messages section

This patch removes the Messages item and its unread-dot/background inbox logic while preserving the rest of the tracker, including workout progression alerts and next-session load recommendations inside Workouts.

Replace these exact files in GitHub:

- `components/AppShell.tsx`
- `app/(app)/layout.tsx`
- `app/(app)/messages/page.tsx`

The old `/messages` URL now redirects to `/workouts`, so it cannot crash even if an old bookmark is used.

No Supabase SQL changes are required. The previously-added `progress_messages_seen_signature` column may remain; it is harmless and no longer used.

Optional cleanup later (not required for deployment):
- delete `components/ProgressMessagesClient.tsx`
- delete `lib/progressInbox.ts`

Do not remove progression logic from `lib/metrics.ts` or `components/WorkoutsClient.tsx`; those power the next-session increase recommendations you wanted.
