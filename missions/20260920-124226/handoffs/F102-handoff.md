# Handoff: F102 — CalendarPage composition test — real data-flow assertions

## Status
COMPLETE

## Assertions covered
AS-001: PASS — buildBlockUserIds/parsePeopleParam tests confirm no ?people= param resolves to [selfId] and blockUserIds is an exact passthrough (never widened to allActive)
AS-002: PASS — resolvePlannerLayout(1) === "week-grid" (called with the real length produced by parsePeopleParam for a single-person selection)
AS-014: PASS — resolvePlannerLayout(1) === "week-grid" and resolvePlannerLayout(2) === "stacked", exercised via both direct calls and the real selection-count derived from parsePeopleParam
AS-023: PASS — layout for a 2-person selection ("carol-id,alice-id") is derived correctly as "stacked" via the same call sequence page.tsx uses
AS-059: PASS — empty/absent ?people= resolves to [selfId] alone (parsePeopleParam), and buildBlockUserIds never contains selfId's teammates unless selected
AS-062: PASS — buildSwitcherMembers excludes pending members from both switcherMembers and activeMemberIds; a ?people= id that only names a pending invite is silently dropped by parsePeopleParam (not treated as active)
AS-063: PASS — parsePeopleParam("carol-id,alice-id", ...) preserves that exact order, not alphabetical

## Files changed
tests/unit/f102-calendar-page-composition.test.tsx

## Commands run
`npx vitest run tests/unit/f102-calendar-page-composition.test.tsx` (0, 8/8 passed)
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f102-calendar-page-composition.test.tsx --max-warnings=0` (0)
`npx eslint . --max-warnings=0` (1 — pre-existing unrelated warning in components/calendar/stacked-planner.tsx, last touched by F036 commit 00f3088d, not part of this feature's scope; my own file lints clean in isolation)

## Decisions made
- Imported the real functions (`parsePeopleParam` from `lib/calendar/people-selection.ts`, `resolvePlannerLayout` from `lib/calendar/planner-layout.ts`, `buildSwitcherMembers`/`buildBlockUserIds` from `lib/calendar/workspace-members.ts`) rather than rendering `page.tsx` itself — the page is an async Server Component with Supabase/auth dependencies that are impractical to mock faithfully in vitest; the clarified spec's own "Approach" section endorses testing the helpers in the same call sequence instead of rendering the page.
- Built fixture data matching the real `ActiveMember`/`PendingInvite`/`WorkspaceMembers` types from `lib/queries/members.ts` (not the simplified shapes in the spec's pseudocode) so the test type-checks against the actual function signatures and stays honest to production data shapes.
- Added an end-to-end test replaying the exact three-call sequence page.tsx uses (parsePeopleParam -> resolvePlannerLayout -> buildBlockUserIds) on one shared selection, in addition to the per-assertion unit tests, per the DoD's emphasis on composition/data-flow rather than isolated units.

## Out-of-scope work needed
- Pre-existing ESLint warning `'sensors' is assigned a value but never used` in `components/calendar/stacked-planner.tsx:121` (from F036) causes `npx eslint . --max-warnings=0` to fail repo-wide. Not touched by F102; a small follow-up should prefix the var with `_` or remove it to restore a clean full-repo lint gate.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used real `lib/queries/members.ts` types (ActiveMember/PendingInvite) for fixtures instead of the simplified `{userId, name, status}` shape shown in the spec's illustrative pseudocode, since `buildSwitcherMembers` is typed against the real `WorkspaceMembers` shape and the spec's snippet was explicitly illustrative ("Approach" section), not a literal contract.

## Notes for the next worker
Mutation testing performed (each applied, run, confirmed fail, reverted, re-verified clean):
1. `buildBlockUserIds` mutated to append a sentinel id -> 2 tests failed (the AS-001/AS-059 passthrough assertion and the end-to-end replay assertion) as expected. Reverted; re-ran suite green.
2. `parsePeopleParam` mutated to `return result.sort();` (alphabetical) instead of insertion order -> the AS-063 order test and the end-to-end replay assertion failed as expected. Reverted; re-ran suite green.
3. `resolvePlannerLayout` mutated from `selectionCount <= 1` to `selectionCount <= 2` (so 2-person selections wrongly resolve to "week-grid") -> the AS-014/AS-023 stacked-layout test failed as expected. Reverted; re-ran suite green.
4. `buildSwitcherMembers` mutated to include pending invites in `switcherMembers` -> the AS-062 exclusion test failed as expected. Reverted; re-ran suite green.

After each revert, re-ran `npx vitest run tests/unit/f102-calendar-page-composition.test.tsx`, `npx tsc --noEmit`, and confirmed `git status --short lib/calendar` was empty before committing, so no mutation leaked into the final commit.

No MCP tools used — this feature is pure application-logic/test work with no external service state.
