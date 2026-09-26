# Progress Forge — shortest deployment checklist

## Supabase
- [ ] Create project
- [ ] SQL Editor → paste/run `supabase/schema.sql`
- [ ] Copy Project URL
- [ ] Copy Publishable key

## Local project
- [ ] Copy `.env.example` → `.env.local`
- [ ] Paste Project URL and Publishable key
- [ ] Run `npm install`
- [ ] Run `npm run dev`
- [ ] Supabase Auth URL config includes `http://localhost:3000/auth/callback`
- [ ] Create an account and verify the app loads

## GitHub
- [ ] Create repository
- [ ] Upload/push project files
- [ ] Confirm `.env.local` is NOT in the repository

## Vercel
- [ ] Import GitHub repository
- [ ] Add `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Add `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] Deploy

## Final Supabase auth change
- [ ] Set Site URL to the Vercel URL
- [ ] Add `https://YOUR-VERCEL-URL/auth/callback` as redirect URL

## Test cross-device sync
- [ ] Sign in on phone
- [ ] Sign in on laptop
- [ ] Add bodyweight on one device
- [ ] Confirm it appears on the other
- [ ] Start workout on phone
- [ ] Save a set
- [ ] Open/refresh workout on laptop and confirm the active session/set appears
