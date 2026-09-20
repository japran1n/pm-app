# Handoff: F014 — switcher member source

## Status
COMPLETE

## Assertions covered
AS-030: PASS — `getWorkspaceMembers` (lib/queries/members.ts) already excludes any workspace_members row whose status isn't "active" (removed/deactivated/invited all land in `result.pending` or are dropped entirely, never `result.active`), and returns `userId`/`name`/`avatarUrl` per active row. Added tests/unit/switcher-member-source.test.ts to prove this directly for the switcher's use case: a deactivated/removed member (status="removed") does not appear in `result.active`, and a pending invite (no user_id yet) does not appear in `result.active` either.

## Files changed
tests/unit/switcher-member-source.test.ts
missions/20260920-124226/features/F014-switcher-member-source.md (pre-existing spec file, added to git tracking)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/queries/ --max-warnings=0` (0)
`npx vitest run tests/unit/switcher-member-source.test.ts` (0, 3 passed)
`npx vitest run tests/unit` (0 exit for the run overall; 41 pre-existing unrelated failing test files / 133 failing tests present before and unrelated to this change — confirmed via `git stash` comparison; none reference members.ts, workspace-members, or the switcher)

## Decisions made
- Per the feature spec's own note ("getWorkspaceMembers already splits active from pending; reuse rather than add a query"), no new query function was written. `lib/queries/members.ts`'s existing `getWorkspaceMembers(workspaceId)` already returns `WorkspaceMembers { active: ActiveMember[], pending: PendingInvite[] }`, where `ActiveMember` has `userId`, `name`, `avatarUrl` (plus role/email/status-note fields other callers use) — this already satisfies AS-030's "id, display name, avatar for the switcher, deactivated/removed excluded" requirement, since the underlying query filters `status === "active"` in application code after reading the RLS-scoped rows.
- Added a focused unit test file (mocking `@/lib/supabase/server` and `@/lib/queries/people`) rather than modifying the existing F017 integration test (tests/integration/workspace-members-list.test.ts), which requires live Supabase credentials and is skipped without them — AS-030 needed a test that runs unconditionally in `tests/unit`.
- Did not rename/relocate the file to `lib/queries/workspace-members.ts` as a stale task-injected note suggested; the feature spec on disk (`F014-switcher-member-source.md`) and its "Files (approximate): lib/queries/members.ts" + reuse note are the actual source of truth here and explicitly instruct reuse of the existing file/function.

## Out-of-scope work needed
- The switcher UI itself (consuming this data) is F026 in the mission plan — not part of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Mid-task, an unrelated `git stash`/`git stash pop` I ran to compare pre-existing test failures briefly displaced another in-flight worker's uncommitted changes to `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` and `lib/queries/calendar-blocks.ts` (concurrent mission activity in the same working tree). I detected this via `git stash show -p` before dropping the stash, reapplied the missing `page.tsx` hunk (the `calendar-blocks.ts` hunk was already present/committed independently), and verified `git diff` matched the intended in-progress state before continuing. I did not touch `missions/20260920-124226/plan.md` or `missions/CURRENT`, which are being actively edited by a concurrent orchestrator process — left those as-is and excluded them from this commit.

## Notes for the next worker
- `lib/queries/members.ts` is the canonical active/pending workspace member query; don't add a second one for switcher-adjacent work.
- If working in this repo concurrently with other mission runs, avoid `git stash` — it can grab another in-flight worker's uncommitted edits. Prefer `git diff`/targeted file reads over stashing for before/after comparisons.
