# Progress Forge v1.5 — Progression Alerts

Replace these files in the existing GitHub repository:

- `components/WorkoutsClient.tsx`
- `lib/metrics.ts`
- `app/globals.css`

No Supabase schema change is required.

## What changed

- A load increase is earned only when all programmed working sets are completed at the same weight and every set reaches the routine's upper rep target.
- As soon as the final qualifying set is saved, a progression popup appears with the exact next-session load.
- The exercise card keeps a visible "Increase next session" reminder after the popup is dismissed.
- On the next workout, the weight input automatically prefills the progressed load instead of the previous load.
- Previous-session guidance now respects the routine's actual target number of sets and routine-specific rep range.
- Mixed-load/ramp sets do not accidentally trigger automatic progression.

Example: 4 sets, target 8–15, increment +2.5 kg

- 35 × 15 / 15 / 15 / 15 -> increase next session to 37.5 kg
- 35 × 15 / 15 / 14 / 15 -> stay at 35 kg and add reps
- 35 × 15 / 15 / 15 only -> no increase yet; complete all 4 working sets
- 30 / 32.5 / 35 / 35 kg -> no automatic increase because working-set loads differ
