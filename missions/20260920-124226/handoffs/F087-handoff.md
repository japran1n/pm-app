# Handoff: F087 — Fix AS-052 — replace source regex with data-flow test via extracted helper

## Status
COMPLETE

## Assertions covered
AS-052: PASS — `buildSwitcherMembers` unit test (`test_AS_052_only_active_members_reach_switcher_and_allowlist`) asserts pending members never appear in `switcherMembers` or `activeMemberIds`; mutation test (added pending to output, ran, reverted) confirmed the test fails when pending members leak in.

## Files changed
lib/calendar/workspace-members.ts (new)
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f029-switcher-url-wiring.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx" lib/calendar/workspace-members.ts tests/unit/f029-switcher-url-wiring.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0, 16/16 passed)
Mutation run: temporarily changed `buildSwitcherMembers` to spread `[...active, ...(pending ?? [])]` → re-ran vitest → `test_AS_052_only_active_members_reach_switcher_and_allowlist` FAILED (`expected length 2 but got 3`), confirming the test is not vacuous. Reverted, re-ran vitest → 16/16 passed again.

## Decisions made
- `buildSwitcherMembers` accepts `{ active, pending? }` (matching spec's example signature) but only ever reads `.active`, so passing the full `WorkspaceMembers` object from page.tsx (or a test fixture with `pending`) can never accidentally leak pending members even if a future edit widens what's read — the mutation test proves this boundary.
- `switcherMembers` in the helper's return value is already mapped to the `{userId, name, email, avatarUrl}` shape the `peopleSwitcherMembers` prop expects (rather than raw `ActiveMember[]`), since page.tsx only ever used it that way and Step 2 of the spec calls for a single call site feeding both the JSX prop and `activeMemberIds` directly.
- `page.tsx`'s other, unrelated `workspaceMembers.active.map((m) => m.userId)` call (for `blockUserIds`, F012/F013's block visibility filter) was left untouched — out of scope per the spec, which only names the `peopleSwitcherMembers` prop and `activeMemberIds` call sites.
- Test fixture for `pending` uses a type cast (`as any` with eslint-disable comment) since `PendingInvite` doesn't naturally carry a `userId` field; this is intentional to simulate "a pending row engineered to defeat the helper" per the mutation-testing intent, not a type-safety gap in the helper itself (`buildSwitcherMembers`'s real signature is properly typed against `WorkspaceMembers`).

## Out-of-scope work needed
None identified beyond the spec's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made `pending` optional in the helper's parameter type (`Partial<Pick<WorkspaceMembers, "pending">>`) rather than required, since page.tsx's `workspaceMembers` object always has both fields already but the spec's own example signature marked `pending?` optional — kept consistent with that example for callers/tests that only care about `active`.

## Notes for the next worker
No MCP usage — this is a pure client/server logic refactor with no external service touched. The old AS-052 source-regex block (F085) is fully removed from `tests/unit/f029-switcher-url-wiring.test.tsx`; any future AS-052-adjacent work should extend the `buildSwitcherMembers` unit test rather than reintroducing a source scan.
