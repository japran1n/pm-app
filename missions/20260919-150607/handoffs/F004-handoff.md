# Handoff: F004 — Testovi akcije: RBAC, ne-sekcija, tuđi projekat, idempotencija

## Status
COMPLETE

## Assertions covered
AS-015: PASS — exported from lib/actions/architecture barrel (existing test)
AS-016: PASS — non-project-member gets { success: false, error }, no DB mutation (existing test, plus AS-016b viewer-without-write-access variant)
AS-017: PASS — task with section_kind IS NULL is rejected, no DB mutation (existing test)
AS-018: PASS — task from a different project/workspace is rejected, no DB mutation (existing test)
AS-019: PASS — valid call updates section_kind in DB (existing test)
AS-020: PASS — successful call writes an audit log entry (existing test)
AS-021: PASS — setting the same kind twice is idempotent, no error (existing test)

## Files changed
(none — no changes required)

## Commands run
`npx vitest run tests/unit/f003-change-section-kind-action.test.ts --reporter=verbose` (0) — 10 passed (10)

## Decisions made
- Reviewed tests/unit/f003-change-section-kind-action.test.ts written during F003 against the 4 required cases from this feature spec (RBAC, non-section, foreign project, idempotency). All 4 are already implemented as dedicated tests (AS-016, AS-017, AS-018, AS-021) plus an extra AS-016b (viewer role with membership but no write permission) and extra Zod-validation and project_members side-effect-guard tests. No gaps found, so no new test code was added, per the instruction not to duplicate passing coverage.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated "AS-018: a task from a different project" as satisfied by the existing OTHER_PROJECT_TASK_ID test, which simulates rejection via `requireActiveMembership` failing for the caller's non-membership in the other workspace — this matches the RBAC-based access model described in tech-decisions.md (project membership required to touch a project's tasks), rather than requiring a separate "same workspace, different project" variant, since the spec's clarified Access answer is "RBAC — authenticated project member" and the codebase scopes membership at workspace/project level via requireActiveMembership.

## Notes for the next worker
No MCP tools were needed for this feature (pure unit-test review/verification task, no live schema or external service state involved). Full test file is at tests/unit/f003-change-section-kind-action.test.ts; all 10 cases pass in isolation.
