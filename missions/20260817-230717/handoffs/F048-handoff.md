# Handoff: F048 — board reload persistence

## Status
COMPLETE

## Assertions covered
AS-075: PASS — new integration test `tests/integration/board-reload-persistence.test.ts` seeds three tasks in one column, calls F046's `reorderTask` to move a card to the bottom then re-queries via F042's `getProjectBoardTasks` (a fresh, independent call simulating a page reload) and asserts the returned `position`-ascending order exactly matches the left-off order; repeats with a second, different reorder to rule out coincidence.

## Files changed
tests/integration/board-reload-persistence.test.ts

## Commands run
`npx vitest run` (0) — 253 tests passed, 46 files
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm run build` (0)

## Decisions made
- Verified (re-read) `lib/queries/tasks.ts::getProjectBoardTasks` — it queries `tasks` filtered by `project_id` + `deleted_at is null` and orders `.order("position", { ascending: true })`. This confirms the AS-078 ordering contract this feature depends on; no code change was needed there, per the spec's "primarily verification" framing.
- Followed the exact `loadDotEnv`/`skipIf(!haveAdminCreds)`/mocked-`createClient` pattern established by `tests/integration/reorder-task.test.ts` (F046) for consistency and to reuse the same real-Supabase-project test infrastructure.
- The mocked `@/lib/supabase/server` `createClient()` routes `.from(...)` calls through to the real admin Supabase client (module-level `adminClientRef`, assigned in `beforeAll`) so `getProjectBoardTasks`'s query actually hits Postgres and exercises the real `.order("position")` clause — not a hand-rolled stub of the query result. `auth.getUser()` stays mocked to the throwaway test user, same as F046's test, since there's no real browser session in a Vitest/node environment.
- Used two sequential reorders producing two different resulting orders (A moved to bottom → B,C,A; then C moved to top → C,B,A) rather than a single reorder, so the test can't pass by coincidence of array/insertion order — each reload-simulating re-query must reflect the specific position values just written.
- Did not touch `app/(workspace)/.../board/page.tsx` (the feature spec's approximate file) — the Server Component there already calls `getProjectBoardTasks` for a fresh fetch on every render/reload; the assertion is proven at the query+action layer, which is the direct, deterministic place to prove ordering survives a reorder, consistent with the spec's own framing ("integration-level check feeding into F090's e2e test").

## Out-of-scope work needed
- F090 (e2e Playwright test for board reorder) should still add a browser-level test that performs an actual drag-and-drop and a real page reload (F5/navigation), per this feature's spec note that this integration test "feeds into" that e2e test rather than replacing it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none)

## Notes for the next worker
- `getProjectBoardTasks` (`lib/queries/tasks.ts`) already selects and maps the `position` field (added by F046) so board-order assertions can be made directly against its return value without extra querying.
- Full `npx vitest run` (not `npm test`, which only runs `tests/unit` per `package.json`) is the correct command to exercise `tests/integration/*` — mirrors what F046's handoff also had to do.
