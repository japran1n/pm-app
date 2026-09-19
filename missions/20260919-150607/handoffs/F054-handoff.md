# Handoff: F054 — idempotency-designed (changeSectionKind no-op fix)

## Status
COMPLETE

## Assertions covered
AS-020: PASS — an idempotent (same-kind) call to `changeSectionKind` now produces exactly one UPDATE and one audit entry across two consecutive calls with the same kind; verified with a dedicated test that counts `updateCallCount` and `auditCalls.length` before and after the no-op second call.

## Files changed
lib/actions/architecture/sections.ts
tests/unit/f003-change-section-kind-action.test.ts

## Commands run
`npx vitest run tests/unit/f003-change-section-kind-action.test.ts` (0)
`npx vitest run tests/unit/f003-change-section-kind-action.test.ts tests/unit/f002-change-section-kind-schema.test.ts tests/unit/f006-section-card-menu-kind-row.test.tsx` (0)
`npm run test -- --run` (background; full-suite run showed pre-existing/concurrent-environment failures unrelated to this change — see Notes)

## Decisions made
- Placed the short-circuit (`if (taskRow.section_kind === parsed.data.kind) return { success: true };`) after the permission checks (membership + `canWrite`) so a viewer still gets rejected before any no-op logic runs, matching the existing ordering convention (auth checks precede business logic) used elsewhere in this file.
- Updated the stale header comment above `changeSectionKind` that previously said "AS-021 ... is just another UPDATE with an unchanged value" — that comment was the root cause of the gap the scrutiny report caught, so I corrected it to describe the short-circuit instead of leaving contradictory documentation next to the fix.
- Added a new test `AS-020: an idempotent (no-op) call produces no UPDATE and no audit entry` rather than only modifying the existing AS-021 idempotency test, per the feature spec's explicit instruction to satisfy this either via the update-count check or the audit-count check across two calls. Kept the original AS-021 test intact since it still validates the return value (`{ success: true }`) is unaffected.

## Out-of-scope work needed
None identified specific to this feature. The stale doc comment fix was a one-line correction directly tied to the bug being fixed, not a scope expansion.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "verify audit write stub was called only once across both calls" (spec option B) together with option A (UPDATE called 0 times on second call) by asserting both `updateCallCount` and `auditCalls.length` stay at 1 after the second no-op call, since both checks are cheap with the existing mock and give stronger coverage than either alone.

## Notes for the next worker
- The full `npm run test` suite run in this shared environment showed 210 failing tests across 262 files (e.g. `tests/unit/watching-feed-query.test.ts` failing with `supabase.rpc is not a function`, and various React-DOM passive-effect errors) that are unrelated to `lib/actions/architecture/sections.ts` or `changeSectionKind` — this environment has many concurrent mission workers touching the same repo checkout simultaneously, and grepping confirmed no other test file references `changeSectionKind` or `architecture/sections` besides the three I ran directly (all passing). Do not treat that full-suite output as a regression introduced by this feature; if it persists outside concurrent-worker noise, it needs its own investigation independent of F054.
