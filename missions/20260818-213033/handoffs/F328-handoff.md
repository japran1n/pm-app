# Handoff: F328 — fix the long-standing `tests/unit/trash-list.test.tsx` failure (pre-existing M14 regression)

## Status
COMPLETE

## Assertions covered
AS-347: PASS — `npx vitest run tests/unit/trash-list.test.tsx` all 3 tests pass, including `test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time` and the null-deleter legacy-row test.

## Files changed
tests/unit/trash-list.test.tsx

## Commands run
`npx vitest run tests/unit/trash-list.test.tsx` (0) — 3 passed (3)
`npx tsc --noEmit` (0) — no output
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/unit` (0) — 129 test files passed (129), 995 tests passed (995)

## Decisions made
- Confirmed the actual failure via the raw error trace before touching anything: `Error: invariant expected app router to be mounted` thrown from `useRouter()` inside `TrashRestoreButton` (components/trash/trash-restore-button.tsx:22), triggered by `react-dom/server`'s `renderToStaticMarkup` executing that Client Component's render during the test (react-dom/server has no server/client boundary — it renders everything, client components included). This confirms the prior "needs a router mock" hypothesis was correct; the component itself is not broken.
- Added `vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))` at the top of the test file, matching the exact convention already used in `tests/unit/board-taskid-deeplink.test.tsx` (only mocked the hooks actually used — `TrashRestoreButton` only calls `useRouter`, unlike the deeplink test which also needs `usePathname`/`useSearchParams`).
- Did not touch `TrashList`, `TrashRestoreButton`, or trash queries — this was purely a test-harness gap (missing mock), not a component bug.
- Did not weaken any assertion: all original `expect` calls (title, project, deleter name present/absent, task key, "Task"/"Comment" badge, no "undefined"/" by null" leakage) are unchanged.

## Out-of-scope work needed
None identified beyond this fix. The suite is now fully green.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the minimal mock shape (`{ refresh: vi.fn() }`) rather than a full router mock with `push`/`replace`/etc., since `TrashRestoreButton` only calls `router.refresh()`. This mirrors the "mock only what's used" style already present in the repo's other router-mocked tests.

## Notes for the next worker
- The one remaining non-test-count anomaly in the full `tests/unit` run is an `Errors 1 error` line (unhandled-rejection style log, `E251`, from `getMentionCandidates` in `lib/actions/comments.ts` via `components/task/comment-list.tsx`, surfacing during `tests/unit/user-avatar.test.tsx`). Verified via `git stash` that this is pre-existing on `main` before this change (identical trace, same file) and does not affect the pass/fail count — `Test Files 129 passed (129)` / `Tests 995 passed (995)` either way. Not touched, per scope discipline; flagging for anyone doing a future cleanup pass.
- `missions/20260818-213033/plan.md` shows as locally modified in `git status` but that diff pre-existed before this worker started (adds F325/F326/F327 lines) and was not made by this session — left untouched/unstaged per the feature's file scope (test file only).
