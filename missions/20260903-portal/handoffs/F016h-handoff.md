# Handoff: F016h — sweep semantics and untested renders

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `classifyBucket` now shares `isDeliverablePastDue` (lib/queries/deliverables.ts) with `getDeliverablesPastDueCount`; 10 tests in tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts pin every state including the `delivered` divergence case, plus a joint test proving the badge count equals the view's blocked count for a fixture set containing a past-due `delivered` row.
AS-030: PASS — `swept_at` is now cleared by a `BEFORE UPDATE` trigger (`client_deliverables_clear_swept_at`) on acceptance/waiver or a `due_at` change, and the sweep now stamps only `v_row.deliverable_id` (the pair it actually acted on), not every overdue deliverable on the task. 2 new integration tests in tests/integration/f013-deliverables-review-and-sweep.test.ts (13/13 passing) cover the primary success case (second deliverable re-blocks) and the due-date-extension case.
AS-048: PASS — `quoteStateLabel` has a new expired branch; `ChangeRequestsTable` render-tested end to end (estimate, price, quote-state badge, no-quote-yet, null-estimate-but-priced) in tests/unit/f016h-change-requests-table-render.test.tsx, 10/10 passing.

## Files changed
supabase/migrations/20261006010000_f016h_swept_at_per_pair.sql (new)
lib/queries/deliverables.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx
components/portal/change-requests-table.tsx
tests/integration/f013-deliverables-review-and-sweep.test.ts
tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts (new)
tests/unit/f016h-change-requests-table-render.test.tsx (new)

## Commands run
`npm run db:apply -- supabase/migrations/20261006010000_f016h_swept_at_per_pair.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts tests/unit/f016h-change-requests-table-render.test.tsx tests/unit/portal-overview-queries.test.ts tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f016c-deliverable-task-scoping.test.ts tests/integration/f016g-default-acl-hardening.test.ts` (0, 71 passed)
`npx vitest run tests/integration/f014-mark-deliverable-delivered.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/integration/f016b-raise-change-request-from-assumption.test.ts tests/integration/f016c-deliverable-task-scoping.test.ts` (0, 29 passed — side-effect verification per DoD)
`npx tsc --noEmit` (0, clean)
`npx eslint lib/queries/deliverables.ts "app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx" components/portal/change-requests-table.tsx tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts tests/unit/f016h-change-requests-table-render.test.tsx tests/integration/f013-deliverables-review-and-sweep.test.ts` (0, clean)

## Decisions made
- Cleared `swept_at` via a table-level `BEFORE UPDATE` trigger rather than editing every writer (`accept_deliverable_atomic`, `updateDeliverable`, any future one). The spec says "cleared on acceptance and on a due-date change" without naming a mechanism, and a trigger is the one place that sees every write regardless of caller — this mission's own M3 scrutiny report flagged "two things that must agree and silently stopped agreeing" as a recurring shape (B6), which a per-caller reset would risk repeating.
- Stamped only `v_row.deliverable_id` in the sweep's second UPDATE, replacing the broad `where task_id = ... and blocking and ...` predicate that matched every overdue deliverable on the task. This is exactly what B3b in M3-scrutiny-2.md named as the bug.
- The trigger function gets no explicit `grant`/`revoke` statement. Verified precedent by grep: `enforce_client_requests_triage_columns_immutable_by_author` (supabase/migrations/20261005010000_f016f_insert_hole_and_reverts.sql, `before insert or update on public.client_requests` trigger, added by F016f) also has no grant/revoke of its own — trigger functions are invoked by the statement that fires them, not via a role-checked RPC call, so F016g's blanket function-grant audit does not need to enumerate it. The `CREATE OR REPLACE` on `sweep_overdue_blocking_deliverables` does not change its grants either (documented in the migration's trailing comment, matching F016f's own comment at :374-377 for the same situation).
- `isDeliverablePastDue(state, dueAt, today)` is the one shared predicate now called by both `getDeliverablesPastDueCount`'s SQL-shaped comment/filters and `classifyBucket`'s TS. `classifyBucket`'s branch order changed: past-due is now checked before the `delivered` special case, so a past-due `delivered` row lands in `"blocked"` (matching the badge) instead of always landing in `"progress"`.
- `quoteStateLabel` takes an explicit `today: string` parameter instead of computing `new Date()` internally, so it stays pure and testable without faking the system clock; `ChangeRequestsTable` computes `today` once per render and passes it down.
- Every new test was verified to fail before being left in its passing state: I applied a throwaway migration reverting the sweep body and dropping the trigger, watched both new AS-030 integration tests fail with the exact "still null"/"still not blocked" symptom the fix addresses, then reapplied the real migration directly via the Management API (the file-based apply script no-ops on an already-recorded version, so I re-ran the same SQL text directly and deleted the throwaway ledger row) and reconfirmed all 13 pass. For AS-003, I mutated `your-list/page.tsx:40` to `return "waiting"` (the exact mutation M3-scrutiny-2.md names) and watched 8/10 tests fail, then reverted from a backup copy and reconfirmed 10/10 pass. For AS-048, I deleted the estimate/price `<span>`s (the exact `change-requests-table.tsx:112-115` M3-scrutiny-2.md names) and watched 2/10 tests fail, reverted, then separately deleted just the expired branch and watched the two expired-specific tests fail, reverted, and reconfirmed 10/10 pass both times.

## Out-of-scope work needed
- B1/B2 (grant model no-op for cron-only functions database-wide beyond this mission's own functions; `client_requests` INSERT hole) are F016g's and F016f's scope respectively and were already remediated by those features per the migration history read for this feature — not reopened here, no new evidence found that they regressed.
- FW (`send_change_request_quote_atomic` routing through `client_gate`) is a separate M3-scrutiny recommendation not assigned to F016h's assertion IDs (AS-003/AS-030/AS-048) — left untouched.
- The row-level `isPastDue` helper inside `components/portal/deliverable-row.tsx` (a third, independent past-due check, used only for the left-rule visual token on already-outstanding rows) was left as-is: it is only ever applied to rows already filtered to `state !== accepted/waived` by the page's own `outstanding` filter, so it cannot diverge from `isDeliverablePastDue` on the accepted/waived axis, and F016h's scope named only the badge/classifyBucket pair.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a `BEFORE UPDATE` trigger over editing each known writer RPC, per the spec's own suggested-fix language in the M3-scrutiny-2.md "FU" recommendation ("Either clear swept_at whenever due_at or state changes (a BEFORE UPDATE trigger...)") — this was the explicitly offered option, not an invented one.
AUTONOMOUS_DECISION: `quoteStateLabel`'s expired check treats `quote_valid_until < today` (strict) as expired, matching `accept_client_request_atomic`'s own CR048 predicate (`quote_valid_until < current_date`) read from supabase/migrations/20261001010000_f016d_one_client_gate.sql — so the label and the RPC that enforces it agree on the exact boundary day.

## Notes for the next worker
- No MCP tools used — Supabase MCP is not authorised for this mission per the task instructions; migration applied via `npm run db:apply` (CLI/Management-API script) and verified with `npx vitest` against the live linked project, matching this mission's existing integration-test convention (tests/integration/f013-deliverables-review-and-sweep.test.ts's own header comment: "Driven through real signed-in sessions ... no test here mocks the function it is asserting about").
- The migration's function comment on `sweep_overdue_blocking_deliverables` now credits F013/F016c/F016e/F016f/F016h and states the per-pair semantics explicitly, so a future reader doesn't have to reconstruct the history from `git blame`.
- `classifyBucket` and `quoteStateLabel` are now both exported (`export function`) purely so tests can import them directly, matching how other pure classifier/label helpers in this codebase (e.g. `components/portal/status-label.ts`) are already tested.
