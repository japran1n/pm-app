# Things only the user can decide or do

## 1. `ANTHROPIC_API_KEY` (blocks nothing structural, blocks one assertion)
Absent from `.env`. Everything builds and tests without it. **AS-047** (prompt caching actually
works, proven by `usage.cached > 0` on a second turn) stays **BLOCKED** until it exists.
Get it at https://console.anthropic.com → API Keys and paste it in chat — the orchestrator writes
it to `.env`. Never paste it into a file or a markdown document.

## 2. Two leaked test workspaces in the PRODUCTION Supabase project
This mission's own integration tests created them, and an early run crashed before cleanup.
A later sweep removed a third; these two survived because the sweep swallows delete errors
(likely a foreign-key reference the sweep's delete order doesn't cover).

| Workspace id | Slug | Name |
|---|---|---|
| `9b0bfd60-129d-404e-b431-912f5f377c5a` | `f027-ws-a-1788791124144-ap6xb2` | F027 Workspace A |
| `c0004d88-8503-4a39-9864-9b476f9a9bda` | `f027-ws-b-1788791124144-ap6xb2` | F027 Workspace B |

No leaked auth users — those were cleaned.

**The orchestrator deliberately did not delete these.** They are empty test fixtures and harmless
clutter, but deletion in a live project is hard to reverse and they sit in the user's real data.
That is the user's call, not an autonomous one. Removing them is a two-row delete whenever
convenient.

**Root cause is already fixed:** the suites are now gated behind `AI_DOCS_LIVE_DB_TESTS=1`, so an
ordinary `npm test` no longer touches the hosted project.

**Still open (mission follow-up, not user action):** `sweepLeakedFixtures` in
`tests/integration/support/live-db.ts` ignores delete errors, so a stuck fixture is invisible in
test output. It should surface unswept ids. Folded into F030.

## 3. Two genuine test defects belonging to mission `20260909-linear-ds`
Confirmed by execution, not inspection, and already reported to that session:
- `tests/unit/app-sidebar-project-nav-list.test.tsx` — `No "useRouter" export is defined on the
  "next/navigation" mock`, from `components/notifications/notification-bell.tsx:114`
- `tests/unit/f038-as024-coverage.test.ts` — `Unable to find an element with the text: Toggle theme`

Not this mission's to fix, and deliberately not fixed here — silently repairing them would hide
that a mission reported 13/13 COMPLETE with a red baseline.
