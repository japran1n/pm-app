# Handoff: F096 — reaction-realtime-delivery.test.ts: measure real delivery time instead of guessing a sixth budget

## Status
COMPLETE

## Assertions covered
AS-369: PASS — `tests/integration/reaction-realtime-delivery.test.ts` (both `it` blocks) pass locally against the hosted Supabase project. `npm run test:realtime` exit code 0, 3 runs in a row. The first `it` (the one CI's 6000ms budget was failing) now logs true elapsed delivery time on both success and eventual failure instead of abandoning the subscription at a fixed budget.

## Files changed
tests/integration/reaction-realtime-delivery.test.ts
vitest.realtime.config.ts

## Commands run
`npx tsc --noEmit` (0)
`set -a; source .env; set +a; npm run test:realtime` (0) — run 3 times, see Notes for elapsed times observed
`npm run test:realtime` alone was NOT run without sourcing .env (per instructions, always sourced)

## Decisions made
- Replaced the fixed 6000ms budget (which resolved `null` and tore down listening the instant it fired) with a single generous 45000ms "measurement ceiling" that is only reached on genuine non-delivery. The listener is never abandoned early — whether the event arrives before or after the old 6000ms mark, the real elapsed time since `SUBSCRIBED` is computed and logged to stderr, and the promise resolves with the real payload. This directly answers the mission instruction: report the true number, don't guess a seventh one.
- Logged on success too (`[AS-369] postgres_changes event received <N>ms after SUBSCRIBED ...`), not only on timeout, per the instruction that a passing run should contribute a data point instead of silence.
- Did not touch the second `it` in the same file (`test_AS_369_the_subscription_is_scoped_...`) or its 6000ms/12000ms budgets — it is one of the three passing sibling tests the instructions say not to touch.
- Bumped the outer vitest per-test timeout for the first `it` from 12000ms to 50000ms (45000ms internal ceiling + slack for the trailing row-existence query), and raised `vitest.realtime.config.ts`'s global `testTimeout` from 30000ms to 50000ms so the runner itself doesn't kill the test before its own internal ceiling/assertion logic gets a chance to run. `hookTimeout` (30000ms, used by `beforeAll`'s connection warmup) was left untouched — out of scope, not implicated by this failure.
- Did NOT change the assertion logic: `received` must be non-null with the correct `comment_id`/`user_id`/`emoji`, and the row must actually exist in the DB. The test still fails (non-null-assertion failure) if the event genuinely never arrives within 45s.

## Out-of-scope work needed
None identified beyond what's already flagged in prior F072/F073/F092/F074 comments in the test file itself.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose 45000ms as the measurement ceiling. Rationale: it must be generous enough to virtually guarantee CI's next run *observes* the real delivery time rather than timing out again (CI's prior true delivery — the one instrumented trace we have, from F074, was 13348ms on a *contended* 4-worker run; on the *uncontended* `test:realtime` step it should be lower, but CI's local Docker Realtime container is unmeasured territory until this run), while still being bounded so the test fails if the event truly never arrives (distinguishing genuine non-delivery from slow-but-real delivery). This is explicitly a measurement-only budget per the mission instructions, not a tuned production budget — the comment in the test file says so and cross-references this handoff.

## Notes for the next worker
What the next CI run (`npm run test:realtime` on CI's Docker Realtime container) will tell us, and what to set the budget to:

- **If the logged elapsed time comes back well under 6000ms** (e.g. matching or close to the 464-1704ms range observed locally against the hosted project in this session, 3 runs) — the earlier 6000ms guess was directionally right but CI's Docker container is occasionally just slow enough to graze past it once. Set the budget to that observed number × ~3-4x headroom for run-to-run variance (e.g. observed ~2000ms → budget ~8000ms), matching the same headroom philosophy F092 used, and update the comment above the timeout to cite this run's number instead of F092's guess.
- **If the logged elapsed time comes back in the same ballpark as F074's contended-run number (roughly 10-15s)** — that would mean CI's local Docker Realtime container itself (not worker contention) is the structural bottleneck, and F092's "uncontended = 1-2s" assumption was simply wrong for CI's environment (self-hosted `supabase start` Realtime, not the hosted project this session measured against). In that case set the budget to that number + ~50% headroom (e.g. observed ~13s → budget ~20s) and say explicitly in the comment that CI's local Realtime container is measurably slower than both local dev and the hosted project, so no further "why is CI slow" investigation is warranted — it's an environment property, not a regression.
- **If the 45000ms ceiling is hit and `null` is logged** — that is a genuine non-delivery (connection drop, RLS regression, filter regression) rather than a timing issue, since 45s is far beyond anything plausible for either contended or uncontended delivery. That should be treated as a real bug report, not a budget problem — check `subscribeToReactionsRealtime`'s filter, the `comment_reactions_select_visible` RLS policy (F199), and whether CI's Realtime container itself is healthy for that run, before assuming it's environmental.

Important scope note: my local measurements (464ms-1704ms, 3 runs) are against the **hosted Supabase project** (`NEXT_PUBLIC_SUPABASE_URL` in this repo's `.env` points to the real linked project), not CI's `supabase start` local Docker Realtime container. These numbers prove the new measurement mechanism works and that delivery is fast and reliable against the hosted backend — they are not a substitute for CI's own number, which is the actual deliverable this mission item is waiting on. Do not set the CI budget from my numbers; wait for the next CI run's own logged elapsed time.

Full test suite (`npm test`) was intentionally NOT run per instructions — only `npm run test:realtime` and `npx tsc --noEmit`.
