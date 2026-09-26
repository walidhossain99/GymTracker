# Progress Forge

A PERSONAL cloud-synced gym progression tracker built with Next.js 16, React 19, Supabase and Recharts.

## Included

- Email/password account creation and login
- Server-verified Supabase auth sessions
- Row Level Security so each account can access only its own training data
- Bodyweight tracking with body-fat %, notes, change metrics and trend chart
- Exercise library with rep ranges and configurable load increments
- Quick per-exercise logging
- Estimated 1RM, session volume and progression charts
- Double-progression guidance (reach the top of the rep range across sets, then increase load)
- Three starter routines
- Active workout mode
- Each set is saved to the cloud immediately
- Resume an unfinished workout on another device
- Previous-session performance beside the current exercise
- Completed workout history
- Analytics for bodyweight, exercise strength and weekly training volume
- Supabase Realtime subscriptions for live refreshes across open devices
- Responsive mobile/desktop UI
- Installable web-app manifest

---

# 1. Create the Supabase backend

1. Go to https://supabase.com and create an account/project.
2. Wait for the project to finish provisioning.
3. Open **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this project.
5. Copy the ENTIRE SQL file into Supabase SQL Editor.
6. Click **Run**.

That creates the database tables, indexes, triggers, Row Level Security policies, and Realtime publication entries.

## Get the two public connection values

In Supabase open the project's **Connect** dialog / API details and copy:

- Project URL
- Publishable key (`sb_publishable_...`)

Do **not** use a secret/service-role key in the browser app.

---

# 2. Configure the project locally

Make a copy of `.env.example` called `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Then run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Local Supabase Auth URL configuration

In Supabase Dashboard → **Authentication** → **URL Configuration**:

- Site URL: `http://localhost:3000`
- Add redirect URL: `http://localhost:3000/auth/callback`

Create your account. On first use, the app automatically creates a starter exercise library and three starter routines.

---

# 3. Put the code on GitHub

Create an empty GitHub repository, for example:

```text
progress-forge
```

Upload/push everything from this project folder EXCEPT `.env.local`.

The included `.gitignore` already prevents `.env.local` from being committed if you use Git normally.

Typical commands:

```bash
git init
git add .
git commit -m "Initial Progress Forge build"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

---

# 4. Deploy to Vercel

1. Go to https://vercel.com and sign in.
2. Click **Add New → Project**.
3. Import the GitHub repository.
4. In **Environment Variables**, add:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use the same values from `.env.local`.

5. Click **Deploy**.

Vercel will give you a URL such as:

```text
https://progress-forge-xxxxx.vercel.app
```

---

# 5. Point Supabase Auth at the deployed site

Once you know your Vercel URL, return to Supabase Dashboard → **Authentication** → **URL Configuration**.

Set:

```text
Site URL:
https://YOUR-VERCEL-DOMAIN.vercel.app
```

Add this redirect URL:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/auth/callback
```

Keep `http://localhost:3000/auth/callback` in the additional redirect list if you still want local development to work.

Now account confirmation emails and login redirects can return to the deployed application correctly.

---

# 6. Use it across devices

On each device:

1. Open the Vercel URL.
2. Sign in to the SAME account.
3. Your Supabase database is the source of truth, so the same bodyweight entries, exercises, workout sessions and sets appear everywhere.
4. While multiple copies are open, Supabase Realtime subscriptions cause relevant database changes to refresh the UI.

You can also use the browser's **Add to Home Screen / Install App** option on supported browsers.

---

# Database layout

- `profiles` — account profile
- `bodyweight_entries` — weight/body-fat history
- `exercises` — personal exercise library and progression settings
- `routines` — workout templates
- `routine_exercises` — ordered exercises inside routines
- `workout_sessions` — active/completed workouts
- `exercise_logs` — one exercise performed within a session (or quick standalone log)
- `exercise_sets` — individual weight/reps sets

Every training table includes `user_id` and Row Level Security. Child rows also verify ownership of referenced parent records.

---

# Progression logic

For an exercise configured as `3 × 6–8` with a `2.5 kg` increment:

- If every saved set reaches at least 8 reps → recommend increasing the load by 2.5 kg next time.
- If every set is inside 6–8 but not all reach 8 → keep the load and add reps.
- If a set falls below 6 → keep/reassess the load until all working sets are back in range.

Estimated 1RM uses the Epley formula and is used only as a longitudinal trend metric.

---

# Production notes

This first release uses Supabase **Postgres Changes** for simple Realtime refreshes. That is appropriate for a personal/low-user tracker. If this becomes a larger public app, migrate database notifications to Supabase Broadcast, which Supabase recommends for scalability.

Never add a Supabase service-role/secret key to any `NEXT_PUBLIC_` environment variable.
