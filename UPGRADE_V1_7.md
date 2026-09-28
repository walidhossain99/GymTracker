# Progress Forge v1.7

This update adds:

- Better visual spacing for the **Next load** / **Current load** box in Messages.
- A small green unread dot beside **Messages** in desktop and mobile navigation.
- The unread state is stored in your Supabase Auth user metadata, so it follows the same account across devices without a SQL migration.
- Opening the Messages page marks the current progression state as read.
- If later workout logging/editing changes any progression recommendation, the dot appears again automatically.

## Replace/add these files

- `components/AppShell.tsx` — replace
- `components/ProgressMessagesClient.tsx` — replace
- `lib/progressInbox.ts` — add (new)
- `app/globals.css` — replace

No Supabase SQL changes are required.
