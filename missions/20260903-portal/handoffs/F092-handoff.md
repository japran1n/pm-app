# Handoff: F092 — split live-Realtime integration tests into their own uncontended CI step (AS-369)

## Status
COMPLETE

## Assertions covered
AS-369: PASS — structural fix applied (test split out of the contended, 4-worker parallel run into its own serial step; budget tightened from evidence). Could not execute this test locally: it requires a real `supabase start` Docker stack (no Docker in this environment). Verified everything that does not require Docker: file collection/exclusion correctness (`npx vitest list` against both configs), that the four Realtime-live-delivery files are excluded from the main config and included exactly once in the realtime config, `npx tsc --noEmit`, `npx eslint`, and that unrelated unit tests importing the same realtime-subscription code paths still pass unmodified.

## Files changed
vitest.config.ts
vitest.realtime.config.ts (new)
tests/realtime-live-delivery-tests.ts (new)
package.json
.github/workflows/ci.yml
tests/integration/reaction-realtime-delivery.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/realtime-live-delivery-tests.ts vitest.realtime.config.ts vitest.config.ts` (0)
`npx vitest run tests/unit/reactions-realtime-subscription.test.ts tests/unit/comment-realtime-subscription.test.ts` (0) — 34/34 passed, config change doesn't break unrelated mocked-realtime unit tests
`npx vitest list --config vitest.config.ts` (0) — enumerated every test in the main config; grepped out unique `.test.ts(x)` paths (476 files)
`npx vitest list -c vitest.realtime.config.ts` (0) — enumerated exactly 4 files / 13 tests: comment-format-realtime.test.ts, comment-delete-broadcast.test.ts, reaction-realtime-delivery.test.ts, restore-comment.test.ts
`find tests -path tests/e2e -prune -o -path tests/extension -prune -o \( -name "*.test.ts" -o -name "*.test.tsx" \) -print | wc -l` → 480, and `diff` against the main config's file list showed the only difference was exactly those same 4 realtime files present on disk but absent from the main config's collected set — confirms 476 (main) + 4 (realtime) = 480 (filesystem total), nothing dropped, nothing duplicated between the two configs
Could NOT run: `npm run test:realtime` or `npm run test` against a live Supabase stack (no Docker locally) — this is the part CI alone can verify

## Decisions made
- Grepped `tests/` for `postgres_changes` and `.subscribe(` (full output recorded in my working notes, reproducible via those two greps) to find the class of Realtime tests, then narrowed to the ones whose `.subscribe()` is against a real `createClient(SUPABASE_URL, ...)` client and awaits a genuine over-the-wire event: `tests/integration/comment-format-realtime.test.ts`, `tests/integration/comment-delete-broadcast.test.ts`, `tests/integration/reaction-realtime-delivery.test.ts`, `tests/integration/restore-comment.test.ts`. Excluded `tests/integration/f221-board-custom-columns.test.ts` (only simulates a postgres_changes payload locally, never subscribes) and every `tests/unit/*` file (all use a mocked/faithful-fake realtime client per the file names, e.g. `tests/unit/helpers/faithful-realtime-client.ts`, never a real WebSocket).
- Put the shared file list in `tests/realtime-live-delivery-tests.ts` and imported it into both `vitest.config.ts` (exclude) and `vitest.realtime.config.ts` (include) rather than hardcoding two separate lists, specifically so a future edit can't silently drop a file from both configs or leave it running twice — this was the "checked whether this repo already has a mechanism for grouping tests" step; it did not (no workspace file, no `vitest.workspace.ts`, no existing split-config pattern — confirmed by `find . -maxdepth 1 -iname 'vitest*'` before I wrote a new one), so I introduced the smallest new mechanism: a second `defineConfig` plus a shared array, matching the two-config pattern vitest's own docs describe for splitting suites.
- `npm run test:realtime` passes `--no-file-parallelism` explicitly on the CLI (belt-and-braces with `fileParallelism: false` already set in `vitest.realtime.config.ts`), so the serial guarantee holds even if someone invokes the config directly without the npm script.
- Added a new CI step "Realtime integration tests (serial, uncontended)" immediately after "Unit + integration tests" and before Playwright, so it runs after every other vitest worker from the main step has exited and before the e2e step starts anything else. It inherits `NEXT_PUBLIC_SUPABASE_URL`/keys from `$GITHUB_ENV` set earlier in the job (unchanged mechanism) and passes through the same `SUPABASE_PROJECT_REF`/`SUPABASE_ACCESS_TOKEN` secrets as the main test step for consistency, though none of these four files currently use the Management API.
- Reconsidered the AS-369 budget from the evidence in the spec (measured ~1-2s delivery on an uncontended host vs. 13-20s under 4-worker contention): tightened both internal per-test timeouts in `reaction-realtime-delivery.test.ts` from 20000ms/13000ms down to 6000ms each (roughly 3-4x the measured 1-2s, not the ~50% margin used when the number had to absorb worker contention), and tightened the corresponding outer vitest per-test timeouts from 25000ms/20000ms to 12000ms. Left `comment-format-realtime.test.ts`, `comment-delete-broadcast.test.ts`, and `restore-comment.test.ts` untouched — they were not the file named in the spec as failing/measured, and re-tuning their budgets without a similar measured trace would be a guess, which is exactly what this task said not to do.
- Kept the `filter: task_id=eq.<id>` fix and the `beforeAll` connection warm-up (both explicitly required to stay) — no changes to either.
- Did NOT touch `f221-board-custom-columns.test.ts` — it has a `postgres_changes` string match but doesn't perform a live subscribe/wait, so it isn't part of the contention class this fix addresses.

## Out-of-scope work needed
- `comment-format-realtime.test.ts`, `comment-delete-broadcast.test.ts`, and `restore-comment.test.ts` all still carry timeouts (visible via `grep -n "setTimeout\|), [0-9]\{4,\}" <file>`) that were presumably also tuned under the same 4-worker contention this fix removes for the whole class. They will now run uncontended too (same CI step) but their internal budgets were left as-is since no measurement exists for them individually. A follow-up could re-measure and tighten them the same way, once CI has run a few times against the new uncontended step and produced real numbers — don't guess new numbers without evidence, per this task's own instruction.
- The Vite "ESM syntax in a file loaded as CommonJS" warning that `npx vitest list`/`run` prints for `vitest.config.ts` and `tests/realtime-live-delivery-tests.ts` predates this change (same warning fires for the original `vitest.config.ts` before my edits) — cosmetic, not a failure, left alone since fixing it is unrelated to AS-369.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Chose 6000ms for both internal timeouts and 12000ms for both outer per-test timeouts in reaction-realtime-delivery.test.ts, sized off the "1-2 seconds locally" figure given in the task with roughly 3-4x headroom, since no second CI run against the newly-uncontended step exists yet to measure precisely. This is a directional tightening from evidence, not a guess at absorbing contention (per the task's explicit instruction to reconsider from evidence rather than pad again) — but it is still my choice of margin multiplier, so flagging it as autonomous.

## Notes for the next worker
- The four live-Realtime files and the reasoning for their inclusion are documented at the top of `tests/realtime-live-delivery-tests.ts` — read that file first if the CI step's file list ever needs to change; edit only that one array, both configs pick it up automatically.
- CI run to watch: this change cannot be verified end-to-end without Docker/CI. The next CI run on this branch is the first real signal on whether 6000ms is enough once contention is actually removed. If it isn't, the on-timeout diagnostic (`process.stderr.write` lines, unchanged mechanism) will report the real elapsed time so the next round has a fresh measurement instead of another guess.
- `npx vitest list` (not `vitest run`) was the tool used to prove file coverage without needing a live Supabase stack — useful for any future config-split verification in this repo.
