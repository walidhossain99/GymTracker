-- Gym Progress Cloud - Supabase schema
-- Paste this entire file into Supabase Dashboard > SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bodyweight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg > 20 and weight_kg < 400),
  body_fat_pct numeric(5,2) check (body_fat_pct is null or (body_fat_pct > 1 and body_fat_pct < 70)),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  muscle_group text,
  rep_min integer not null default 6 check (rep_min between 1 and 100),
  rep_max integer not null default 8 check (rep_max between 1 and 100 and rep_max >= rep_min),
  increment_kg numeric(6,2) not null default 2.5 check (increment_kg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  position integer not null default 0,
  target_sets integer not null default 3 check (target_sets between 1 and 20),
  rep_min integer not null default 6 check (rep_min between 1 and 100),
  rep_max integer not null default 8 check (rep_max between 1 and 100 and rep_max >= rep_min),
  created_at timestamptz not null default now(),
  unique (routine_id, exercise_id)
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  session_date date not null default current_date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  performed_on date not null default current_date,
  order_index integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_log_id uuid not null references public.exercise_logs(id) on delete cascade,
  set_number integer not null check (set_number between 1 and 50),
  weight_kg numeric(7,2) not null check (weight_kg >= 0 and weight_kg < 2000),
  reps integer not null check (reps between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exercise_log_id, set_number)
);

create index if not exists idx_bodyweight_user_date on public.bodyweight_entries(user_id, entry_date desc);
create index if not exists idx_exercises_user on public.exercises(user_id);
create index if not exists idx_routines_user on public.routines(user_id);
create index if not exists idx_routine_exercises_routine_position on public.routine_exercises(routine_id, position);
create index if not exists idx_sessions_user_date on public.workout_sessions(user_id, session_date desc);
create index if not exists idx_logs_user_exercise_date on public.exercise_logs(user_id, exercise_id, performed_on desc);
create index if not exists idx_logs_session on public.exercise_logs(session_id, order_index);
create index if not exists idx_sets_log_set on public.exercise_sets(exercise_log_id, set_number);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists bodyweight_set_updated_at on public.bodyweight_entries;
create trigger bodyweight_set_updated_at before update on public.bodyweight_entries for each row execute function public.set_updated_at();
drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at before update on public.exercises for each row execute function public.set_updated_at();
drop trigger if exists routines_set_updated_at on public.routines;
create trigger routines_set_updated_at before update on public.routines for each row execute function public.set_updated_at();
drop trigger if exists sessions_set_updated_at on public.workout_sessions;
create trigger sessions_set_updated_at before update on public.workout_sessions for each row execute function public.set_updated_at();
drop trigger if exists logs_set_updated_at on public.exercise_logs;
create trigger logs_set_updated_at before update on public.exercise_logs for each row execute function public.set_updated_at();
drop trigger if exists sets_set_updated_at on public.exercise_sets;
create trigger sets_set_updated_at before update on public.exercise_sets for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row Level Security: every user can only access their own rows.
alter table public.profiles enable row level security;
alter table public.bodyweight_entries enable row level security;
alter table public.exercises enable row level security;
alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.exercise_logs enable row level security;
alter table public.exercise_sets enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all" on public.profiles for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Top-level owner policies.
drop policy if exists "bodyweight_entries_owner_all" on public.bodyweight_entries;
create policy "bodyweight_entries_owner_all" on public.bodyweight_entries for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "exercises_owner_all" on public.exercises;
create policy "exercises_owner_all" on public.exercises for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "routines_owner_all" on public.routines;
create policy "routines_owner_all" on public.routines for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Child-table policies also verify that referenced parents belong to the same user.
drop policy if exists "routine_exercises_owner_all" on public.routine_exercises;
create policy "routine_exercises_owner_all" on public.routine_exercises for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.routines r where r.id = routine_id and r.user_id = (select auth.uid()))
  and exists (select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.routines r where r.id = routine_id and r.user_id = (select auth.uid()))
  and exists (select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid()))
);

drop policy if exists "workout_sessions_owner_all" on public.workout_sessions;
create policy "workout_sessions_owner_all" on public.workout_sessions for all to authenticated
using (
  (select auth.uid()) = user_id
  and (routine_id is null or exists (select 1 from public.routines r where r.id = routine_id and r.user_id = (select auth.uid())))
)
with check (
  (select auth.uid()) = user_id
  and (routine_id is null or exists (select 1 from public.routines r where r.id = routine_id and r.user_id = (select auth.uid())))
);

drop policy if exists "exercise_logs_owner_all" on public.exercise_logs;
create policy "exercise_logs_owner_all" on public.exercise_logs for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid()))
  and (session_id is null or exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid()))
  and (session_id is null or exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
);

drop policy if exists "exercise_sets_owner_all" on public.exercise_sets;
create policy "exercise_sets_owner_all" on public.exercise_sets for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.exercise_logs l where l.id = exercise_log_id and l.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.exercise_logs l where l.id = exercise_log_id and l.user_id = (select auth.uid()))
);

-- Realtime for this small personal app. Supabase recommends Broadcast for larger scale,
-- but Postgres Changes is intentionally used here for a simple single-user / low-user tracker.
do $$
declare t text;
begin
  foreach t in array array['bodyweight_entries','exercises','routines','routine_exercises','workout_sessions','exercise_logs','exercise_sets']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
