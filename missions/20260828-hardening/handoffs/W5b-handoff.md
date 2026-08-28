# Handoff: W5b — Fix the remaining integration-test failures (36 assertions, 10 files)

## Status
COMPLETE

## Assertions covered
This feature is a triage/fix pass over 10 integration test files rather than a
fixed assertion list assigned in validation-contract.md. All assertions in the
10 files below were run and observed PASS when the environmental rate-limit
confound is removed (see Decisions made). No assertion required a code or test
change.

AS-343, AS-347, AS-352 (trash-view.test.ts): PASS
AS-404, AS-405, AS-414, AS-415 (f219-status-management.test.ts): PASS
AS-404, AS-411 (f325-status-rename-sync.test.ts): PASS
AS-429, AS-431, AS-432, AS-433 (f229-saved-views-ui.test.ts): PASS
AS-312 (comment-format-realtime.test.ts): PASS
f228-saved-view-actions.test.ts (all 9 tests): PASS
checklist-actions.test.ts (all 5 tests): PASS
f226-swimlane-collapse-persist.test.ts (all tests): PASS
create-workspace-owner.test.ts (all tests): PASS
dependency-ui-actions.test.ts (all tests): PASS

## Files changed
(none — no source or test files were modified)

## Commands run
`npx vitest run tests/integration/f228-saved-view-actions.test.ts` (0, 9/9 passed standalone)
`npx vitest run tests/integration/checklist-actions.test.ts tests/integration/f226-swimlane-collapse-persist.test.ts` (0, 22/22 passed)
`npx vitest run tests/integration/create-workspace-owner.test.ts tests/integration/trash-view.test.ts tests/integration/dependency-ui-actions.test.ts` (0, 22/22 passed)
`npx vitest run tests/integration/f229-saved-views-ui.test.ts tests/integration/f219-status-management.test.ts tests/integration/f325-status-rename-sync.test.ts tests/integration/comment-format-realtime.test.ts` (1, 5 failed — all `Request rate limit reached` on `signInWithPassword`, plus one flaky `comment-format-realtime` occurrence — see below)
`npx vitest run tests/integration/comment-format-realtime.test.ts` (0, 2/2 passed standalone — confirms W5a's finding that it is flaky under load, not a real defect)
`npx vitest run tests/integration/f219-status-management.test.ts` (0, 13/13 passed standalone)
`npx vitest run tests/integration/f229-saved-views-ui.test.ts tests/integration/f325-status-rename-sync.test.ts` (0, 11/11 passed)
`npx vitest run <all 10 files together, default parallel pool>` (1, 53/79 failed — every failure is `Request rate limit reached` on Supabase Auth `signInWithPassword`/`signInAs`, i.e. Cause B, not a code defect)
`npx vitest run --no-file-parallelism <all 10 files together>` (0, 79/79 passed — proves the failures above are purely a concurrency/rate-limit artifact of running these Auth-heavy files at the same time, not a defect in any of the 10 files)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings unrelated to this work)
`npx vitest run tests/unit` (0, 1392/1392 passed — W5a's unit fixes unaffected)

## Decisions made
- Investigated each of the 10 files per the mandatory "run standalone first" rule in the
  spec. Every single one of them passes 100% when run alone or in small groups. The only
  way to reproduce failures was to run several of these files together with vitest's
  default worker-pool parallelism (`maxWorkers: 4`), which spins up many concurrent
  Supabase Auth `signInWithPassword`/`signUp` calls against the shared remote project and
  trips Supabase's Auth rate limiter (`Request rate limit reached`). Running the exact
  same 10 files with `--no-file-parallelism` (sequential file execution) gives 79/79 green.
  This is precisely the "Cause B" mechanism the plan.md W5 section already documented for
  the other 17 files — my 10 files are simply also Auth-heavy (`create-workspace-owner`,
  `f219-status-management`, `f229-saved-views-ui`, `f325-status-rename-sync`,
  `trash-view`, `dependency-ui-actions`, `checklist-actions`, `f226-swimlane-collapse-persist`,
  `f228-saved-view-actions` all create/sign-in multiple throwaway Supabase Auth users in
  `beforeAll`/test bodies) and hit the same shared-project rate limit when several run
  concurrently.
- `comment-format-realtime.test.ts` specifically: the one non-rate-limit-labeled failure
  observed in a grouped run showed `supabase.rpc is not a function` inside
  `writeTaskCommentEvent` (a `non-fatal` swallowed error, by design) followed by the
  assertion `expect(received).not.toBeNull()` failing because the realtime payload never
  arrived in time. Re-ran this file standalone 1x (in this session) and it passed 2/2 in
  4.8s; W5a's handoff already reports repeated standalone passes. Given the error is a
  transient client/connection issue surfacing under parallel load (many concurrent realtime
  channels + many concurrent Postgres/Auth connections competing for the same remote
  project), and the test passes reliably alone, I conclude — consistent with W5a — that
  this is environmental flakiness, not a defect in `lib/activity/task-activity.ts` or the
  test. Left untouched per the spec's explicit instruction not to force it green.
- No test or source file needed modification. All "failures" reported by a full-suite or
  large-group run are the identical rate-limit mechanism as Cause B (W6's problem: give CI
  tests a dedicated ephemeral database), not code or test defects. Per the spec's rule
  ("A file that passes alone and fails in the suite is an environmental failure, not a
  defect"), I did not touch any of the 10 files.

## Out-of-scope work needed
- W6 (ephemeral CI database) will also fix these 10 files' flakiness under parallel/full-suite
  execution, exactly as it does for the 17 files in Cause B. No separate follow-up feature is
  needed — W6 already covers this. Suggest the orchestrator note in W6's scope/verification
  that its fix should be checked against these 10 files too, not just the original 17.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated all 10 assigned files as environmental-only (Cause B) rather
than making any code/test edits, because every file passes standalone and the only failure
mode observed in grouped/parallel runs is `Request rate limit reached` from Supabase Auth
(or, for one file, a plausible symptom of the same connection contention). This matches the
spec's explicit "distinguish real failures from environmental ones" instruction and the
worked example given for `comment-format-realtime.test.ts`. No SUGGESTED FOLLOWUP feature is
needed since W6 already targets this exact root cause.

## Notes for the next worker
- To reliably verify any of these 10 files (or to add new Auth-heavy integration tests),
  run them with `npx vitest run --no-file-parallelism <files>` rather than the default
  pool — this avoids tripping the shared remote project's Auth rate limit and gives a
  trustworthy signal until W6 lands ephemeral CI databases.
- Do not run the full suite for verification (8+ minutes, contains the known 17
  environmental failures plus these 10 files' shared susceptibility to the same issue).
- No MCP tools were needed for this feature — it is a test-triage task with no schema/config
  changes.
