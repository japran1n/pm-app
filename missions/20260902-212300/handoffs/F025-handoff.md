# Handoff: F025 — Fix-up: pin request-changes in-flight ref cleanup (AS-016)

## Status
COMPLETE

## Assertions covered
AS-016: PASS — `components/portal/approval-actions.test.tsx` 12/12 green (2 new tests). Mutation-verified: moving `inFlightRef.current = false` out of the request-changes `finally` block (`approval-actions.tsx:113-118`) is now KILLED by `test_AS_016_ref_is_cleared_after_a_rejected_action_allowing_retry` and `test_AS_016_ref_is_cleared_after_ok_false_allowing_retry`.

## Files changed
components/portal/approval-actions.test.tsx

## Commands run
`npx vitest run components/portal/approval-actions.test.tsx` (0, 12/12 passing)
`npx vitest run components/portal/approval-actions.test.tsx` against the mutant described below (2 failures as expected — mutation-verification, then reverted)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors / 15 pre-existing warnings, unchanged from baseline)
`npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**"` (0, 209 files / 1636 tests passing)
`git status --porcelain -- components/portal/approval-actions.tsx` (clean — no source file changes)

## Decisions made
- No production code change was needed: `components/portal/approval-actions.tsx:113-118` already resets `inFlightRef.current = false` inside `finally` (correct). The scrutiny finding (MAJOR-1 / AS-016) was purely a **test coverage gap** — the mutant that removes that protection survived every existing test. This is a pure test-addition fix-up.
- Followed F021's established pattern exactly (per the task instructions): mirrored `test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry` and `test_AS_014_ref_is_cleared_after_ok_false_allowing_retry` for the request-changes path.
- Used the F021-established **test-only Button stub** (`vi.resetModules()` + `vi.doMock("@/components/ui/button", ...)`) for both new tests, not the `retryButton.removeAttribute("disabled")` trick the approve tests use. Reason (discovered empirically, not assumed): the request-changes Send button disables via `disabled={isPending || !message.trim()}`, and waiting for `isPending` to settle back to `false` after a rejected/failed action raced unpredictably with React's transition scheduling in this suite — passing in isolation but flaking to a permanently-"disabled" button when run after `test_AS_015_second_synchronous_approve_click_issues_no_second_call` (that test intentionally leaves an approve deferred promise unresolved, and full-suite runs showed the Send button never clearing `disabled` within the `waitFor` window). The real Base UI `Button` enforces `disabled` inside its own click closure (documented already in `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled`), so the DOM-attribute-removal approach that works for approve's plain click doesn't reliably apply here either. Routing through the stub Button — already established and comment-documented in this file for exactly this reason — makes the second click deterministically reach `handleRequestChanges` regardless of `isPending`/`disabled` timing, so the test isolates `inFlightRef.current` behaviour specifically, which is what AS-016 is about.
- Checked for other symmetric unpinned-cleanup shapes in this component: only two `finally` blocks exist (`handleApprove` and `handleRequestChanges`); both now have retry-after-failure coverage on both the throw and `{ ok: false }` branches. No other symmetric gap of this shape was found in `approval-actions.tsx`.

## Out-of-scope work needed
- MAJOR-2 (AS-027, board.tsx rollback release sites) — explicitly out of scope per task instructions (do not touch `components/board/`). Tracked as FU-Q in scrutiny-3.
- MAJOR-3/FU-R (`lib/actions/portal-approval.ts` request-changes non-atomicity) — explicitly out of scope per task instructions (do not touch `lib/actions/portal-approval.ts`).
- MAJOR-4/FU-S, MAJOR-5/FU-T (SQL `search_path`, RPC note-invariant) — explicitly out of scope per task instructions (do not touch `supabase/migrations/`).
- Observed during the full-suite run: `tests/integration/f229-saved-views-ui.test.ts` (8/8 tests) failed with `revalidatePath` "no active request/render context" errors. This is unrelated to F025/AS-016, not in `components/portal/`, and was not touched by this worker. Given multiple concurrent `vitest`/worker processes were visibly running against this repo at the same time (other workers active in parallel, per `ps aux`), this looks like environment/DB contention rather than a regression from this change — confirmed by running the full non-integration suite (`--exclude tests/integration/** --exclude tests/e2e/**`) cleanly at 209/209 files, 1636/1636 tests. Flagging for the orchestrator to re-check in isolation if it recurs.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the test-only Button stub over the DOM-attribute-removal retry pattern for both new AS-016 tests, based on empirical full-suite flakiness with the attribute-removal/`waitFor(isPending settles)` approach. This matches the precedent and reasoning already established in this same file's `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled` test, so it is not a new pattern — just applied to a second scenario in the same file.

## Notes for the next worker
- The mutation applied for verification: moved `inFlightRef.current = false` from the request-changes `finally` block to run only on the success tail (after `router.refresh()`), leaving both the `catch` block and the `if (!result.ok) { …; return; }` branch without a reset — exactly mirroring the shape scrutiny-3 described for the approve mutant. Confirmed KILLED (2 failures) with the mutant applied, confirmed clean (12/12 pass) after reverting via `cp` from a pre-edit backup, and `git status --porcelain -- components/portal/approval-actions.tsx` was clean at the end (no stray production-code diff).
- No MCP tools were needed — this is a pure client-component test fix-up with no external service or live-state involvement.
