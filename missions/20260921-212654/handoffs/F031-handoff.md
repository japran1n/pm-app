# Handoff: F031 — guest gate in permissions, fail closed

## Status
COMPLETE

## Assertions covered
SB-034: PASS — role matrix (owner/admin/member show; viewer/client/guest hide; guest with manage=true hides; null membership hides) on desktop and 375px Sheet, real Chromium; server action matrix in f031 test.
SB-006: PASS — guest filtering untouched (isGuest prop and filterGuest unchanged); guest-with-manage still shows no + New; existing sidebar/guest tests unchanged and green.

## Files changed
lib/auth/permissions.ts
lib/actions/projects.ts
components/nav/new-menu.tsx
tests/unit/f009-sb033-sb034-new-menu.test.ts
tests/unit/f031-sb034-create-project-gate.test.ts
missions/20260921-212654/handoffs/F031-handoff.md

## Commands run
`npx vitest run tests/unit/f031-sb034-create-project-gate.test.ts tests/unit/f009-sb033-sb034-new-menu.test.ts` (0, 64 passed)
`npx vitest run tests/unit` (full unit scope; 46 failing files, all in baseline; zero new failing files vs baseline-failing-files.txt)
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0)
Mutation check: reverted new-menu gate to permissive-null; both null_membership tests failed (desktop and 375px); restored.

## Decisions made
- Added `canCreateProject(ctx)` in permissions.ts as an explicit ALLOW-list: owner, admin, member. Everything else (viewer, guest, client, future roles) denied.
- Finding correction: the server did NOT actually let guests in; createProject already had a separate `role === "guest"` check. The real defect was duplicated authority. Server behaviour is unchanged: the previous pair (canWrite + guest check) denies exactly viewer/client/guest, and allows owner/admin/member, identical to the new predicate. Error messages preserved ("Guests cannot create projects." / viewers message).
- Sidebar: `!isGuest && membership !== null && canCreateProject(...)`. The isGuest prop stays as an extra deny only (guest flag true with canManage true still hides). Null membership fails closed.
- Role matrix (sidebar and server): owner Y, admin Y, member Y, viewer N, guest N, client N, null membership N (sidebar; server requires active membership already).
- No MCP used.

## Out-of-scope work needed
- MembershipContext doc comment still says absent membership is "permissive by convention"; other consumers (CommentList/TimeTracking) keep that fallback. Only new-menu was changed.
- Layout falls back to role "guest" on memberships query error, which now hides + New; the error is still only logged.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: kept the `isGuest` prop as a deny-only term rather than removing it, so the SB-034 "guest with canManage true" case remains double-guarded.

## Notes for the next worker
Not verified: a live authenticated Next page; the server action test mocks membership and the admin client (gate reached is proven by the admin client being invoked). Old F009 tests still assert the SB-033 flows.
