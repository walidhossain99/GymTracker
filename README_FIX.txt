Progress Forge v1.6.2 hotfix

This package fixes the version mismatch shown by Vercel:
- getProgressionDecision missing from @/lib/metrics
- progressionRecommendation called with 3 args while old metrics accepted fewer
- @/components/ProgressMessagesClient missing

OVERWRITE these exact paths in your GitHub repo:

components/WorkoutsClient.tsx
components/ProgressMessagesClient.tsx
components/AppShell.tsx
lib/metrics.ts
lib/types.ts
app/(app)/messages/page.tsx

Important:
- Do NOT upload these files to the repository root.
- Keep the folder structure exactly as shown.
- Commit all six files in ONE commit so Vercel sees a matched version set.

Quick verification before commit:
1. Open lib/metrics.ts and search for: export function getProgressionDecision
2. Open components/ProgressMessagesClient.tsx and confirm its import uses @/lib/metrics
3. Confirm app/(app)/messages/page.tsx imports @/components/ProgressMessagesClient
