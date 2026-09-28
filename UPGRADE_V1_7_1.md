# Progress Forge v1.7.1 runtime hotfix

This fixes the Messages page runtime crash introduced by the unread-message feature.

## What changed
- Removed browser `supabase.auth.getUser()` / `auth.updateUser()` calls from the app shell.
- The authenticated user ID is now passed from the protected server layout.
- Message read-state is stored in `public.profiles`, not Auth user metadata.
- Added defensive error handling so a message-inbox failure cannot crash the whole app.
- Keeps the unread dot synchronized across open devices through Supabase Realtime.

## 1. Run the SQL migration once
In Supabase Dashboard > SQL Editor > New query, paste and run:

`supabase/migration_v1_7_1.sql`

## 2. Replace these files in GitHub
- `components/AppShell.tsx`
- `components/ProgressMessagesClient.tsx`
- `app/(app)/layout.tsx`
- `app/(app)/messages/page.tsx`

Then commit to `main`. Vercel will redeploy automatically.
