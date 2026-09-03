# Handoff: F006g — One source of truth for what a status means to a client

## Status
COMPLETE

## Assertions covered
AS-015: PASS — `resolveClientBucket`/`clientStatusLabel` never match a status by name (grep-clean), and there is exactly one exported bucket→label map (`CLIENT_BUCKET_LABELS`, `components/portal/status-label.ts`) imported by `pages-table.tsx`, `status-distribution.tsx` and `status-manager.tsx`. A null `status_id` renders a neutral "No status" pill. Verified by `components/portal/status-label.test.ts`, `status-pill.test.tsx`, `pages-table.test.tsx`, `task-list.test.tsx` (unit, all pass) and `tests/integration/f005-portal-pages.test.ts` (integration, live Supabase, all pass).
AS-017: PASS — `not_started` with no override now resolves to the "progress" bucket, never "waiting"; a Backlog page is absent from "Waiting on you" on both the Overview and the Pages distribution, proved on the same fixture rows by a new cross-screen agreement test. Verified by `status-label.test.ts`, `status-pill.test.tsx` and `tests/integration/f005-portal-pages.test.ts::test_AS_015_AS_017_the_overviews_waiting_list_and_the_pages_distributions_waiting_count_agree` (live Supabase, passes).

## Files changed
components/portal/status-label.ts
components/portal/status-label.test.ts
components/portal/status-pill.tsx
components/portal/status-pill.test.tsx
components/portal/pages-table.tsx
components/portal/pages-table.test.tsx
components/portal/status-distribution.tsx
components/project/status-manager.tsx
components/portal/task-list.tsx
components/portal/task-list.test.tsx
lib/queries/portal.ts
tests/integration/f005-portal-pages.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 20 pre-existing warnings — identical baseline to M1-scrutiny-2's own lint run)
`npx vitest run components/portal/status-label.test.ts components/portal/status-pill.test.tsx components/portal/task-list.test.tsx` (0, 35 passed)
`npx vitest run components/portal/pages-table.test.tsx components/portal/status-distribution.test.tsx` (0, 7 passed)
`npx vitest run components/portal/approval-actions.test.tsx components/portal/pages-table.test.tsx components/portal/status-distribution.test.tsx components/portal/status-label.test.ts components/portal/status-pill.test.tsx components/portal/task-list.test.tsx tests/unit/portal-approval-action.test.ts` (0, 78 passed — every unit test file that imports `PortalTask`/`PortalProject`/`resolveClientBucket`/`clientStatusLabel`/`StatusPill`/status-label/status-pill/status-distribution/pages-table/status-manager)
`npx vitest run tests/integration/f005-portal-pages.test.ts` (0, 7 passed — live Supabase, credentials from `.env`; this is the F005 integration suite this feature's own DoD requires to still pass, updated where it asserted the old mapping)
Did NOT run the full vitest suite (per instructions — avoids Supabase auth rate-limit collision with a concurrent agent).

## Decisions made
- **Defect 1 (not_started falsely "waiting"):** kept the four buckets — no fifth bucket needed. Changed `CATEGORY_BUCKET_FALLBACK` so `not_started` resolves to `"progress"` (grouped with in-progress work, per the spec's own suggested resolution: "not_started belongs with in-progress work as 'not started yet'"), not `"done"` and not a new bucket. `"waiting"` is now reachable ONLY via an explicit `client_bucket = 'waiting'` override or `pending_client_approval` — never via any category fallback.
- **"Agree by construction" (Overview vs. Pages distribution):** extended `resolveClientBucket(category, clientBucket, pendingClientApproval?)` with a third, optional parameter. `pendingClientApproval` wins over the status's own bucket (mirrors the Overview's original `isAwaitingReview` priority) except when `category === "done"` (a delivered task is never "waiting"). Both `getPortalOverview` and `getPortalPages` now route their "is this row waiting" decision through this one function instead of two independent definitions (Overview used to check only `pending_client_approval`; Pages used to check only `category`/`client_bucket`). `tasks.pending_client_approval` is documented in `20260916010000_approval_requests.sql:14` as "a denormalised indicator" kept in sync with F007's `approval_requests` table, so this also covers the spec's third listed source ("an open approval request") without a second join — verified by reading that migration, not assumed.
- **Defect 2 (`/review/i` regex):** deleted. `clientStatusLabel` now takes `(category, clientBucket)` instead of `(category, rawStatus)` and derives its phrase from `resolveClientBucket`. Its wording ("Waiting on your review" / "Delivered" / "Blocked" / "In progress") is deliberately its own copy, not `CLIENT_BUCKET_LABELS` verbatim — `status-pill.tsx`'s own pre-existing comment already documents why this heading's vocabulary is intentionally distinct from the generic bucket labels (a different surface, the shared-tasks list's group headings). This required threading `clientBucket` through `PortalTask`, `PortalProject.statuses`, and the Realtime merge path (`task-list.tsx`'s `CategoryLookup`→`StatusMeta`, `mergeIncomingTask`) so a task's bucket is resolved the same way whether server-rendered or updated live — not a shortcut that only fixed the regex textually while leaving the live-update path unable to know a status's real bucket.
- **Defect 3 (triplicated map):** single `export const CLIENT_BUCKET_LABELS: Record<ClientBucket, string>` in `status-label.ts`. `pages-table.tsx`'s `FILTER_LABELS`, `status-distribution.tsx`'s label half of `BUCKET_META` (split into `BUCKET_TONE`, which stays local — colour is this component's own presentation concern, not part of "what a bucket is called"), and `status-manager.tsx`'s `CLIENT_BUCKET_OPTIONS` all now read this one map. `status-manager.tsx`'s copy had drifted ("Waiting on client" / "Done" vs. "Waiting on you" / "Ready to launch") — unified to the client-facing wording since that select is choosing what the CLIENT will read.
- **Defect 4 (null status_id → empty coloured pill):** `PortalPageStatus.id`/`.name` changed to `string | null`; `getPortalPages` now passes `null` instead of `""` sentinels. `StatusPill`'s `name` prop is `string | null` — `name === null` short-circuits to a neutral pill (`bg-muted`/`text-muted-foreground`, no `--status-*` token) reading "No status", with no tooltip trigger.
- Did not touch `approval_requests`/F007 code — `pending_client_approval` is the documented denormalised signal for it, so no new join was needed for M1-era correctness.

## Out-of-scope work needed
- `getPortalOverview` (and `getPortalActivitySummary`, `getPortalFiles`) still read `projects` workspace-wide with no `portal_enabled` filter (flagged as latent, not a live leak, in M1-scrutiny-2's "residue" note under B1) — untouched here; not part of this feature's Scope.
- AS-002 (`page.tsx:94,111` two-scope badge disagreement) and AS-011 (`getProjectPhases` silently defaulting to `not_started` on a failed `project_statuses` read) are both still open per M1-scrutiny-2 — neither is AS-015/AS-017, out of this feature's assigned assertions.
- `page-travel-strip.tsx`'s seven-step static copy ("In design → Waiting on you → …") and `overview-tiles.tsx`'s literal "Waiting on you"/"Ready to launch" strings were left as-is: they are fixed prototype workflow-stage copy, not `Record<ClientBucket, …>` lookups, so they were never one of the three triplicated copies the M1-scrutiny cited and are not a name-matching mechanism.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `not_started → "progress"` over inventing a fifth bucket. The spec explicitly offered this as one of two acceptable resolutions ("not_started belongs with in-progress work as 'not started yet' or with done as neither — decide"); grouping with "done" would misrepresent unstarted work as finished, so "progress" is the only one of the two that reads correctly to a client, and it keeps the four-bucket schema the spec asked to preserve.
AUTONOMOUS_DECISION: Added `pendingClientApproval` as a third parameter to `resolveClientBucket` rather than leaving Overview and Pages with two independently-computed "waiting" predicates. The spec's scope item 1 said "make the Overview's waiting list and the Pages distribution agree by construction," which is not satisfiable by fixing only the `not_started` fallback — a status with an explicit `client_bucket = 'waiting'` override, or a task with `pending_client_approval = true`, would otherwise still disagree between the two screens (Overview never read `client_bucket`; Pages never read `pending_client_approval`). Verified via grep (`supabase/migrations/20260916010000_approval_requests.sql:14`) that `pending_client_approval` is the documented, kept-in-sync proxy for an open approval request before relying on it, rather than assuming.

## Notes for the next worker
- `resolveClientBucket`'s new signature is `(category, clientBucket, pendingClientApproval = false)` — backward compatible, existing two-arg callers are unaffected (default `false`).
- `PortalTask`, `PortalProject.statuses`, and `PortalPageStatus` all grew a `clientBucket`/`client_bucket` field (or, for `PortalPageStatus.id`/`.name`, became nullable). Any future object literal of these types (new tests, new mocks) needs the field — `tsc --noEmit` will catch a miss immediately, which is how the two stale test fixtures (`task-list.test.tsx`, the `PortalTaskDetail` return in `getPortalTaskDetail`) were actually found during this change.
- No MCP tools were used — this feature is pure application-code/query-logic; no live schema or policy inspection was needed (the `client_bucket` column and its check constraint already existed from F004's `20260911010000_status_client_bucket.sql`, read but not modified).
- `tests/integration/f005-portal-pages.test.ts` now also exercises `getPortalOverview` against the same fixture — if a future change alters that fixture's status/task shape, keep `homepageTaskId` (explicit `waiting` override) and `unorderedTaskId` (`not_started`, no override) pointed at rows that actually exercise both ends of the agreement test.
