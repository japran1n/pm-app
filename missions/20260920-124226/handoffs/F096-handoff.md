# Handoff: F096 — Fix AS-001/AS-059 — make userIds required in getCalendarBlocks

## Status
COMPLETE

## Assertions covered
AS-001: PASS — `userIds: readonly string[]` is now a required (non-optional) parameter of `getCalendarBlocks`; `test_AS_001_userIds_is_required_param` in `tests/unit/f031-page-layout-derivation.test.tsx` uses `@ts-expect-error` to prove omitting it is a compile error, and `npx tsc --noEmit` confirms 0 errors with the required signature.
AS-059: PASS — `test_AS_059_block_fetch_scoped_to_selection_not_all_members` (existing, unchanged) still passes; the compile-time fix means the block fetch can no longer silently widen to all members via a dropped 4th argument — any such regression is now a type error, not a runtime data leak.

## Files changed
lib/queries/calendar-blocks.ts
tests/unit/f031-page-layout-derivation.test.tsx (this file's diff was already present at HEAD when I checked — see Notes)
tests/integration/calendar-blocks-crud.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f031-page-layout-derivation.test.tsx` (0)
`npx vitest run tests/unit/calendar-blocks-active-members.test.ts tests/unit/calendar-blocks-people-filter.test.ts` (0)
`npx vitest run tests/unit` (nonzero — 133 pre-existing failures across 41 unrelated files, e.g. f003/f006/f007/f025 CMS-portal test suites; confirmed via `git stash` that the exact same 133 failures exist on HEAD before my change, so none are caused by this feature)
`npx next build` (0 — full production build succeeds, including the TypeScript check step)
`git commit` (0)

## Decisions made
- Changed `userIds?: readonly string[]` to `userIds: readonly string[]` (required) in `lib/queries/calendar-blocks.ts`, and simplified the function body: the `if (userIds !== undefined)` branch is gone, the active-member restriction logic always runs, and the trailing `if (restrictedUserIds !== undefined)` guard on the query is removed since `restrictedUserIds` is now always defined by the time the query is built.
- Ran `npx tsc --noEmit` after the signature change to find call sites missing the 4th argument (per spec Step 3), rather than grepping — this is the authoritative way to find compile errors. It found exactly one: `tests/integration/calendar-blocks-crud.test.ts:397`, which I fixed by passing `[memberUserId]` (the test creates blocks as `memberUserId` and asserts on blocks belonging to that user, so scoping to that id is correct and doesn't change the assertion's meaning).
- The app call site (`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`) and all other test call sites (`calendar-blocks-active-members.test.ts`, `calendar-blocks-people-filter.test.ts`) already passed an explicit `userIds` argument — no changes needed there.
- Added the type-level test using the actual positional-argument signature (`getCalendarBlocks("w1", start, end)` omitting the 4th arg) rather than the object-literal form (`getCalendarBlocks({ workspaceId: "w1" })`) shown in the spec's illustrative snippet, because the real function signature takes four positional arguments, not an options object. The `@ts-expect-error` mechanics are the same either way — the spec's snippet was illustrative pseudocode, not the literal call shape.
- The returned (now-required-args) call in that test is a real async call into `createClient()`/Supabase with no env/test mocks in that file, so it will reject at runtime; the test only cares about the compile-time behaviour, so the promise rejection is swallowed via `.catch(() => undefined)` to avoid an unhandled rejection failing the test run.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the real positional-argument call shape for the `@ts-expect-error` test instead of the spec's object-literal example, since `getCalendarBlocks` has never taken an options object — this is a faithful implementation of the spec's intent (compile-time enforcement of a required 4th argument), not a deviation from it.

## Notes for the next worker
- When I re-read `tests/unit/f031-page-layout-derivation.test.tsx` after making my edit, `git status`/`git diff HEAD` showed my added test already matched HEAD exactly (i.e., it appeared to already be committed under commit `780cb1a7 docs(F097): add handoff` / an earlier commit in this branch's history for that file). This suggests another concurrent process in this repo touched the same file with equivalent content, or a stash round-trip I did for baseline-failure verification interacted with an in-flight commit. I verified via `git log --oneline -- tests/unit/f031-page-layout-derivation.test.tsx` that the test is present in history and via `npx vitest run` that it passes, so functionally this is fine, but flagging the oddity in case the orchestrator sees a discrepancy between this handoff's "Files changed" and the actual diff in my commit `54476bbd` (which only shows `lib/queries/calendar-blocks.ts` and `tests/integration/calendar-blocks-crud.test.ts` because the test file had no diff against HEAD to commit).
- No MCP tools used — this is a pure TypeScript/logic fix, no live Supabase schema or policy changes.
