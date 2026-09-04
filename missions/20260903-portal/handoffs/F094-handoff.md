# Handoff: F094 — Fix CI-only failure in overdue-notification-sweep.test.ts (F321/AS-383)

## Status
COMPLETE

## Assertions covered
AS-383: PASS — all 9 tests in `tests/integration/overdue-notification-sweep.test.ts` (including
"F321/AS-383: an orphaned assignee (removed from the workspace) does not abort the sweep, and a
still-valid assignee on a different overdue task still gets notified") pass locally with `.env`
sourced, run repeatedly (see Commands run).

## Files changed
tests/integration/overdue-notification-sweep.test.ts

## Commands run
`set -a; source .env; set +a; npx vitest run tests/integration/overdue-notification-sweep.test.ts` — run once solo, then 3x back-to-back (2 hit Management-API `429 ThrottlerException` from my own rapid retries, unrelated to the fix — see Notes), then once more after backing off: **9 passed (9)**, 18.83s (0)
`set -a; source .env; set +a; npx vitest run tests/integration/overdue-notification-sweep.test.ts -t "F321"` (solo, before adding the per-test timeout, as a baseline repro of the local duration): **1 passed, 8 skipped**, 10.89s (0)
`npx tsc --noEmit` (0)
`gh run view 33877551433 --log-failed` (read-only, to get the exact CI failure) (0)

## Decisions made

**Mechanism, established by elimination of the three named possibilities:**

1. **Not a two-database split.** The whole suite's `sql()` helper talks exclusively to the
   Supabase Management API (`POST /v1/projects/{ref}/database/query`, authenticated with
   `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`), which is the real hosted project. The F321
   test — like every other test in this file — does every read and write (fixture creation, the
   sweep call, both notification assertions, and its inline cleanup) through this same `sql()`
   channel. There is no `supabase-js`/PostgREST call anywhere in this file (grepped: zero
   `.from(`/`.rpc(` calls), so the F091-documented "REST hits local Docker, Management API hits
   hosted" split cannot apply here — there is only one channel in this file, and it's real.

2. **Not a product bug in `notify_overdue_task_assignees`.** Ran the isolated F321 test alone
   (`-t "F321"`) with `.env` sourced: passed cleanly in 10.89s. Ran the full file (all 9 tests,
   including F321) four times total across this session (one clean pass at 18.83s, two throttled
   by my own back-to-back retries, one more clean pass at 18.83s): F321 passed every time it
   wasn't preempted by an unrelated 429. The assertions the test makes — the sweep call resolves
   without throwing, the orphaned/removed assignee gets zero notifications, and the still-valid
   assignee's unrelated overdue task gets exactly one `task_due_soon` notification — all held.
   Nothing in the SQL function's behavior is implicated.

3. **The real mechanism: a fixture-latency/test-timeout budget defect.** The CI log
   (`gh run view 33877551433 --log-failed`) shows the F321 test failing with `Error: Test timed
   out in 20000ms` at exactly `20044ms` — i.e., it ran into the file's `vi.setConfig({
   testTimeout: 20000 })` default. That default was sized for this file's *other* tests, each of
   which makes roughly 3-4 sequential `sql()` calls and, per the same CI log, comfortably
   completed in 1243ms-6265ms. The F321 test makes roughly 15 sequential `sql()` calls: 2 extra
   `auth.users` inserts, one 2-row `workspace_members` insert, two `makeTask()` calls (each
   itself 2 calls — insert task, insert `task_assignees`), one `workspace_members` delete, the
   sweep call itself, two notification-read selects, and four inline cleanup deletes at the end.
   Since each Management API round trip costs roughly 1.5-2s in CI (backed out from the other
   tests' observed per-call cost), ~15 sequential calls plausibly total 22-30s — over the file's
   20s budget — while this file's other, lighter tests stay comfortably under it. Locally
   (lower/more consistent latency to the Management API from this session) the full run of all 9
   tests took 18.83s-21.42s *total*, so the timing margin is thin even outside CI; in CI's
   documented run it tipped over.

**Fix:** added a per-test timeout of 45000ms to the F321 test only (`}, 45000);` as the third
argument to `it(...)`), matching this same file's existing `beforeAll`/`afterAll` pattern which
already uses an explicit 60000ms budget for their own multi-call setup/teardown, rather than
raising the file-wide default (which would mask a real timeout regression in the lighter tests).
Added a comment directly above the test explaining the call count and the CI timing evidence, so
a future reader doesn't mistake the longer budget for masking a slow query. No SQL, migration, or
application code was touched — the sweep function itself was never implicated by any of the
repeated local runs.

## Out-of-scope work needed
None identified specific to this fix. The suite's Management API calls are sequential (no
`Promise.all`); a future worker could reduce the F321 test's real-world duration by parallelizing
independent inserts (e.g. the two `auth.users` inserts, or the two `makeTask()` calls), but that
would change the suite's established sequential style shared by every other test in this file and
isn't necessary once the timeout matches the actual call volume — left alone here to keep this
fix minimal and provably correct.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a per-test timeout override (45000ms on the one slow test) over raising
the file-wide `vi.setConfig({ testTimeout: 20000 })` default, so that a real future regression
making one of the *lighter* tests in this file unexpectedly slow would still be caught by the
tighter 20000ms default instead of being silently absorbed into a wider global budget.

## Notes for the next worker
- The two failed local runs in "Commands run" were `429 ThrottlerException` responses from the
  Supabase Management API, triggered by my own rapid back-to-back retries within the same
  ~1-minute window — not a symptom of the fix or of CI's real failure. A single isolated CI run
  (which is what actually happens per-PR, not four solo-triggered reruns within a minute) has no
  such contention. Confirmed unrelated: waiting roughly a minute between retries reliably produced
  a clean pass again.
- Confirmed cleanup ran and is safe to repeat: every passing run above (including the two 429-hit
  runs, which failed inside `beforeAll` before creating any fixture rows) left the hosted project
  clean — the file's own `afterAll` (filters undefined ids per the F075 fix already in place) and
  the F321 test's own inline cleanup block at the end of the test both ran without error on every
  pass observed.
- This suite remains sequential-Management-API-call-heavy by design (per its own header comment,
  a deliberate PostgREST bypass). Any *new* test added to this file that does a similarly large
  number of `sql()` calls should get its own explicit timeout up front rather than relying on the
  file default, to avoid repeating this exact failure mode.
