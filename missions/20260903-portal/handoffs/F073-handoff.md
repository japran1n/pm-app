# Handoff: F073 — Structural fixes for two remaining CI failures (waitFor flake class + AS-369 handshake budget)

## Status
COMPLETE

## Assertions covered
AS-014: PASS — `test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry` and its `ok:false` sibling both pass, 4 consecutive isolated runs and under a concurrent full-suite-contention stress run (see Commands run).
AS-369: PASS — both tests in `tests/integration/reaction-realtime-delivery.test.ts` pass; the delivery test's wall time dropped from a CI-observed 13364ms (over the 13000ms budget) to ~750-1100ms locally against the real linked project, with the one-time connection cost now paid in `beforeAll`.

## Files changed
tests/setup/testing-library.ts (new)
vitest.config.ts
components/portal/approval-actions.test.tsx
tests/integration/reaction-realtime-delivery.test.ts

## Commands run
`npx vitest run components/portal/approval-actions.test.tsx` x3 isolated (0, 12/12 passed each)
`npx vitest run components/portal/approval-actions.test.tsx` x4 while a full-suite run (`npx vitest run`, all 482 files) ran concurrently in the background, to reproduce `maxWorkers: 4` contention (0, 12/12 passed each run)
`npx vitest run tests/integration/reaction-realtime-delivery.test.ts` x4 (0, 2/2 passed each, ~5-6s wall incl. setup teardown, test bodies 750-1092ms)
`node timing-probe.mjs` (ad hoc probe script, deleted after use) — measured `subscriberClient`'s first-ever `.channel().subscribe()` handshake at 1134ms against the real linked project (not CI's cold local container)
`npx vitest run` (full suite, local, against the real linked remote Supabase project, not CI's local Docker stack) — 427 passed / 55 failed / 482 files; the 55 failures are all `Request rate limit reached` / credential-refusal-style errors from running the entire integration suite against a shared remote Supabase Auth rate limit locally, not from either target file — verified via `grep -c "FAIL.*reaction-realtime-delivery\|FAIL.*approval-actions"` = 0 in the run log
`npx tsc --noEmit` (0)
`npm run build` (0)

## Decisions made
- **Failure 1 (approval-actions.test.tsx, AS-014 retry test)**: Diagnosed as timing, not a logic bug, before touching anything. Ran the un-widened test 3x in isolation (always passed, ~900ms total suite time) and read the CI failure trace: `expected "vi.fn()" to be called 2 times, but got 1 times` at `wait-for.js:118` (`Timeout.checkRealTimersCallback`) — a genuine `waitFor` timeout firing, not an assertion mismatch inside a settled callback. The file's own sibling test (`test_AS_014_ref_is_cleared_after_ok_false_allowing_retry`) had already been individually widened to `timeout: 5000` for the *identical* pattern one round earlier, with a comment explicitly documenting the "flakes only under `maxWorkers: 4` contention, never in isolation" mechanism — that is direct proof the class-level cause is real, not a one-off.
- Fix: added `tests/setup/testing-library.ts`, wired into `vitest.config.ts`'s `test.setupFiles` (previously unset — confirmed via grep before adding, so this isn't duplicating an existing mechanism), which calls `configure({ asyncUtilTimeout: 5000 })` from `@testing-library/dom` once, globally, for every test file. This raises the *default* that every unadorned `waitFor`/`findBy*` call in the whole suite uses, so no single call site can be next week's mole. Then removed the now-redundant per-call `{ timeout: 5000 }` overrides from the sibling test (they duplicated the new global default) and updated its stale comment.
- Chose 5000ms (not something larger) because it's the exact value the prior round already proved sufficient for the sibling test under the same contention, and this task's instructions warn against inflating budgets without a concrete precedent — this reuses that one.
- **Failure 2 (reaction-realtime-delivery.test.ts, AS-369)**: Established "late vs never" using the CI log (`gh run view 33851817811 --log-failed`): the failure is `expected null not to be null` at line 349 (`expect(received).not.toBeNull()`), where `received` is the promise's resolved value — and the *only* code path that resolves to `null` is the 13000ms `setTimeout`. So the event was never observed within budget; that's consistent with either "arrives late" or "genuinely lost," not yet distinguishing them.
- Distinguished the two by reasoning about what's structurally different between this test (the file's *first* test, and the *first-ever* `.channel().subscribe()` call on `subscriberClient` in the whole file) and its passing sibling (reuses the same already-open WebSocket for a second channel — a channel *join*, not a new connection) and `comment-format-realtime.test.ts` (a wholly separate file/worker with its own client, but not measuring a cold-start connection either, since its own first subscribe already happens inside its timed test in the same shape). Probed the actual cost of that first handshake against the real linked project with a throwaway script: 1134ms just to reach `SUBSCRIBED` on a fresh client with no prior channels. CI's Realtime container is `supabase start`-ed cold in the same job (confirmed in `.github/workflows/*.yml`) and competes for the runner's 2 vCPUs against `maxWorkers: 4` — a cold-boot handshake taking multiple seconds there, eating most of a 13s budget before the INSERT is even issued, plausibly explains the 364ms overrun without any delivery defect.
- Fix: moved the one-time WebSocket-establishment cost into `beforeAll` via a throwaway `f202-warmup` channel subscribe/unsubscribe, so `subscriberClient`'s connection is already open and warm before either timed test's clock starts. This doesn't touch either test's 13000ms/13000ms budget — the budgets are unchanged, they just now measure the same thing (channel-join + delivery) that the passing sibling test already measured, instead of connection-establishment + join + delivery. This is the honest fix for "handshake, not delivery": if delivery itself were ever actually lost, this change wouldn't help and the test would still fail with `null` at line 349, giving a clean, unambiguous signal for that hypothesis if it turns out to be wrong in CI.
- Kept the `filter: task_id=eq.<taskId>` fix and F072's mechanism comment intact — that part of the prior round's diagnosis was correct and is not touched.

## Out-of-scope work needed
- Five failures in the CI run (`f016i`, `f016l`, `f025-portal-table-triple-sweep`, `f025e-guard-hardening`, `overdue-notification-sweep`) are credential refusals, explicitly out of scope per the task brief — untouched.
- Could not verify against CI's actual cold local Supabase/Realtime Docker stack (no Docker available in this environment); verification here is against the real linked remote project instead, which is warm/always-on and therefore structurally cannot reproduce a cold-container handshake cost — only the *mechanism* (first-subscribe pays a one-time connection cost the sibling doesn't) was confirmed, not the exact CI magnitude. If a next CI run somehow still times out at line 349 with `received === null`, that would falsify "handshake" in favor of "genuinely lost delivery" and warrants a fresh investigation (e.g. Realtime replication slot lag under the cold container specifically) rather than another budget bump.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the redundant per-call `waitFor(..., { timeout: 5000 })` overrides in `test_AS_014_ref_is_cleared_after_ok_false_allowing_retry` after adding the global `asyncUtilTimeout: 5000` default, since they became dead weight duplicating the new global config and their comment (referencing "F320" and per-call widening) would otherwise mislead a future reader into repeating the whack-a-mole pattern this fix eliminates.
AUTONOMOUS_DECISION: Placed the new setup file at `tests/setup/testing-library.ts` — the repo had no `setupFiles` mechanism at all (confirmed via grep of `vitest.config.ts` and `package.json`), so there was no existing convention to match; `tests/setup/` was chosen as the most discoverable location alongside `tests/unit/` and `tests/integration/`.

## Notes for the next worker
- The `timing-probe.mjs` script used to measure the handshake cost was a throwaway, run from the repo root and deleted immediately after — not committed, and not needed again unless someone wants to re-measure against a different project/network.
- `tests/setup/testing-library.ts` is loaded for every test file regardless of `environment` (`node` or `jsdom`) — `configure()` from `@testing-library/dom` is a no-op for files that never call `waitFor`/`findBy*`, so this is safe for the many non-DOM integration tests too.
- No MCP tools were used for this feature — it's test-infrastructure-only, no live external service state was inspected or changed.
