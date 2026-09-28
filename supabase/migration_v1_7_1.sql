-- Progress Forge v1.7.1
-- Stores the Messages read-state in the existing per-user profile row.
-- Run once in Supabase Dashboard > SQL Editor.

alter table public.profiles
  add column if not exists progress_messages_seen_signature text;

-- Enable profile updates in Realtime so the unread dot can synchronize across open devices.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
