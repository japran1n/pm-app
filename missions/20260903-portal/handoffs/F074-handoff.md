# Handoff: F074 — Round 3 CI failure triage (approval-actions AS-014 retry test; reaction-realtime AS-369 budget)

## Status
PARTIAL

## Assertions covered
AS-014: PASS — `test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry` now passes deterministically (12/12 tests in the file, 3 consecutive local runs, ~258ms each).
AS-369: UNTESTED (mechanism, not fixed) — no code/budget change made. Passes locally against the real linked remote Supabase project (4 consecutive runs), but the CI-only overrun's root cause is still unknown; this pass adds diagnostics only, per the explicit instruction not to guess a fourth timing theory.

## Files changed
components/portal/approval-actions.test.tsx
tests/integration/reaction-realtime-delivery.test.ts

## Commands run
`npx vitest run components/portal/approval-actions.test.tsx` (0) — 3 consecutive runs, 12/12 passed each time, ~258ms tests duration each
`npx vitest run tests/integration/reaction-realtime-delivery.test.ts` (0) — 4 consecutive runs against the real linked remote Supabase project (`.env` has live credentials, `haveAdminCreds` true locally), 2/2 passed each time
`npx vitest run components/portal/approval-actions.test.tsx tests/integration/reaction-realtime-delivery.test.ts` (0) — combined run, 14/14 passed
`npx tsc --noEmit` (0)

## Decisions made
- **Failure 1 (AS-014):** Verified the stated mechanism before fixing, per instruction. Mutated `handleApprove`'s catch block in `components/portal/approval-actions.tsx` to skip `inFlightRef.current = false` on the throw path (kept the `finally` block, since `finally` runs unconditionally regardless of an early `return`, so the first mutation attempt — adding a `return` before an unchanged `finally` — was a no-op; the second attempt removed the `finally` and inlined the ref-clear only on success/ok:false paths). Ran the target test with that mutation in place: it failed with the identical `expected 2 times, but got 1 times` error at `approveMock.toHaveBeenCalledTimes(2)` as production CI. This confirms the assertion is actually exercising the ref guard, not an artifact of the test's own construction. Reverted the mutation (confirmed clean `git diff` on the source file), then fixed the test itself using the exact `vi.doMock("@/components/ui/button", …)` stub pattern already present in the same file for `test_AS_016_ref_is_cleared_after_a_rejected_action_allowing_retry` (components/portal/approval-actions.test.tsx, originally lines 236-311, cited by name in the new test's comment) — the stub always forwards `onClick` regardless of the `disabled` prop, so Base UI's internal click-closure guard (`useButton`'s `getButtonProps().onClick` capturing `disabled` at render time) can no longer race React's `isPending` settling. Did not touch the production component (`components/portal/approval-actions.tsx`) — no diff there.
- **Failure 2 (AS-369):** Followed the instruction literally: stop inferring, instrument, let CI answer. Added `TEMP-DIAGNOSTIC (F074, AS-369, remove once mechanism is known)`-tagged `process.stderr.write` calls with elapsed-ms timestamps at: promise-executor start, each `.subscribe()` status callback (including `SUBSCRIBED`/`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`), the moment `toggleReaction()` is called, when it resolves or rejects, and every `postgres_changes` event received (with the comment_id it carried vs. the expected one, so a wrong-row match is visible too). Did not touch the 13000ms internal timeout or the 18000ms `it()` budget. Did not add a skip.
- No MCP tools were used — both fixes are local test-file changes; `mcp-registry.md` was not consulted since neither failure required live schema/policy introspection (F074's mission spec is triage, not a schema-touching feature).

## Out-of-scope work needed
- The AS-369 CI failure's actual mechanism is still unknown. The next worker (or the orchestrator after the next CI run) needs to grep the CI job's stderr for `[F074-DIAG AS-369]` lines and read off the elapsed-ms sequence to determine which of the three candidate mechanisms it is:
  1. `.subscribe()` never reaches `SUBSCRIBED` within the 13000ms budget → the CLOSED/CHANNEL_ERROR/TIMED_OUT diagnostic line (or its absence) will show this.
  2. `SUBSCRIBED` arrives but `toggleReaction()` never resolves, or resolves but no `postgres_changes event received` line ever appears → points at either the INSERT itself failing/hanging, or Realtime not pushing the change.
  3. The event does arrive but after the 13000ms mark → the diagnostic line's own `+Nms` timestamp will show N > 13000, and the `resolve(null)` fallback line's timestamp shows exactly when the budget fired relative to it.
  Once CI reproduces the failure with these diagnostics in place, the fix is mechanical from there. Remove the `TEMP-DIAGNOSTIC` block once the mechanism is confirmed and any real fix is applied — do not leave debug stderr noise in permanently.
- Local runs against the real linked remote Supabase project consistently showed the `postgres_changes` INSERT event arriving *twice* per single `toggleReaction()` call (both times with the correct `comment_id`) — see the two `postgres_changes event received` lines per run in `Commands run` output captured during this session. This did not affect AS-369's pass/fail (the promise resolves on the first matching event and the second is a no-op against an already-settled promise), but it may be worth a separate look — possibly harmless duplicate delivery from Realtime's own retry/replication behavior, or a double-subscription artifact from a channel/socket left open by a previous test run's `afterAll`. Flagging it as out-of-scope observation, not a defect confirmed against this feature's assertions.

## Blockers
N/A — Status is PARTIAL rather than BLOCKED only because AS-369's root cause genuinely requires a CI run to observe (it doesn't reproduce locally against the real project); this is not a blocker requiring a decision, it is exactly the diagnose-then-wait step the mission brief asked for. No `SUGGESTED FOLLOWUP` is written as a new feature because the next step is "read the CI log," not additional implementation work — the orchestrator (or the next worker) should re-run CI, pull the `[F074-DIAG AS-369]` lines from the job log, and act on whichever of the three mechanisms above they show.

## Autonomous decisions
AUTONOMOUS_DECISION: For AS-014, chose to migrate the entire test body to the `vi.doMock`+dynamic-import pattern (matching AS-016's sibling exactly, including its `vi.resetModules()`/`vi.doUnmock()` bracketing) rather than a smaller patch, so future readers see one consistent idiom for "defeat the real Button's closure guard" across both AS-014 and AS-016's retry tests in this file.
AUTONOMOUS_DECISION: For AS-369, chose stderr (not stdout or a log file) for diagnostics since vitest's CI runner already surfaces stderr inline in the failing-test output block (confirmed locally: the diagnostic lines appear directly above the `Test Files` summary in `vitest run` output), so no extra CI config or artifact upload is needed to read them.

## Notes for the next worker
- The mutation used to verify AS-014's mechanism: in `handleApprove`'s `startTransition` callback, moving `inFlightRef.current = false` out of a `finally` and into only the success/`!result.ok` branches (leaving the `catch` branch without it) reproduces the exact CI failure. This was reverted before committing — `git diff` on `components/portal/approval-actions.tsx` is empty in the final commit.
- `.env` in this working tree has live credentials for a real linked remote Supabase project (`qcipqonnqajmazdbysow` per `supabase status`), not a local Docker stack — `supabase status -o` even reports `docker: command not found`, confirming there is no local Postgres/Realtime container here. This is why `tests/integration/reaction-realtime-delivery.test.ts` was runnable at all locally in this session (`haveAdminCreds` was true), despite the task description's assumption that Docker/local stack access is unavailable — it's unavailable, but the test doesn't need it here since it's pointed at the real remote project.
- Do not remove the `TEMP-DIAGNOSTIC` stderr lines until a CI run has actually captured them and the mechanism is identified — removing them now would repeat the same guess-and-check cycle that failed three times already.
