# Handoff: F021 — Fix-up: kill surviving AS-014/AS-016 mutants in approval-actions

## Status
COMPLETE

## Assertions covered
AS-014: PASS — `test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry` and `test_AS_014_ref_is_cleared_after_ok_false_allowing_retry` added; mutation-verified against moving `inFlightRef.current = false` out of the `finally` block onto the success-only path.
AS-016: PASS — `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled` added; mutation-verified against deleting `if (!trimmed) return;`.

## Files changed
components/portal/approval-actions.test.tsx

(components/portal/approval-actions.tsx is byte-identical to HEAD — no production defect found; both mutants were weak-test findings, not real bugs.)

## Commands run
`npx vitest run components/portal/approval-actions.test.tsx` (0, 10/10 passed — baseline, no mutant)
`npx tsc --noEmit` (0)
`npx eslint components/portal/approval-actions.test.tsx components/portal/approval-actions.tsx` (0, no output)
`npm run lint` (0 errors, 15 pre-existing unrelated warnings — matches scrutiny-2.md's AS-032 finding)
`npx vitest run --exclude "**/tests/integration/**" --exclude "**/tests/e2e/**"` (0, 209 files / 1627 tests passed — full non-integration/e2e regression sweep)

### Mutation verification (all 4 results recorded)

**Mutant 1 — AS-014.** Moved `inFlightRef.current = false` from the `finally` block onto the success path only (approval-actions.tsx:75-83 restructured so `finally` no longer clears the ref on the catch/ok:false paths).
- Applied: `npx vitest run components/portal/approval-actions.test.tsx` → **2 failed / 8 passed** — both new AS-014 tests failed (`toHaveBeenCalledTimes(2)` timed out because the retry click never issued a new call). Mutant KILLED.
- Restored (`cp` from pre-edit backup, confirmed `diff` clean against original): → **10/10 passed**.

**Mutant 2 — AS-016.** Deleted `if (!trimmed) return;` from `handleRequestChanges` (approval-actions.tsx:88).
- Applied: `npx vitest run components/portal/approval-actions.test.tsx` → **1 failed / 9 passed** — `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled` failed with `requestChangesMock` called with `["task-1", ""]`, i.e. the guard-less code let a blank message through. Mutant KILLED.
- Restored → **10/10 passed**.

After both restores, `diff /tmp/approval-actions.tsx.bak components/portal/approval-actions.tsx` showed no difference — production file is clean, confirmed via `git diff --stat components/portal/approval-actions.tsx` showing zero changes at commit time.

## Decisions made
- **AS-014 fix**: added two tests (reject path and `{ok:false}` path) that click Approve, let the first attempt fail, then click Approve again and assert `approveMock` is called a second time. To avoid depending on React's `isPending`-driven `disabled` render timing (which proved flaky across the suite — see below), the retry click strips the `disabled` attribute defensively before firing, so the test isolates the ref guard (`inFlightRef.current`) itself rather than accidentally re-testing `isPending` UI timing, which is not what AS-014 is about.
- **Ordering fix (pre-existing flakiness discovered, not introduced)**: initially placed the two new AS-014 tests *after* the existing `test_AS_015_second_synchronous_approve_click_issues_no_second_call` test. That existing test (untouched, F014's work) deliberately leaves its mocked action's promise permanently unresolved (`deferred<...>()` whose `resolve`/`reject` are never called) to prove the ref blocks the second synchronous click. Running my new tests immediately after left the Approve button observably `disabled` in the *next* test even though its own transition had genuinely settled — a real cross-test interaction via React's transition scheduler, not a flaw in my assertions (confirmed by running the new tests in isolation, where they passed immediately). Rather than touch the AS-015 test (explicitly out of scope per instructions) or rely on a `disabled`-clearing race that proved unreliable, I moved both new AS-014 tests to run *before* AS-015 in file order and additionally hardened the retry click to strip `disabled` defensively, so the tests are robust regardless of ordering or scheduler artifacts from neighboring tests.
- **AS-016 fix — genuine architectural finding**: attempting the "strip the `disabled`/`data-disabled` attribute then click" approach (matching AS-014's technique) does **not** work for AS-016, because `@/components/ui/button`'s underlying primitive (`@base-ui/react/button`'s `useButton`) enforces `disabled` entirely inside its `onClick` wrapper's JS closure (`getButtonProps().onClick = (event) => { if (disabled) { event.preventDefault(); return; } externalOnClick?.(event); }`), reading the `disabled` prop captured at render time — not the DOM node's `disabled`/`data-disabled` attributes. No DOM-level manipulation can bypass it; a real `<button disabled>` also cannot receive dispatched clicks in jsdom/browsers regardless. Verified this by reading `node_modules/@base-ui/react/internals/use-button/useButton.js` directly. Given the component's `disabled={isPending || !message.trim()}` prop is structurally identical to the handler's own `if (!trimmed) return;` guard, there is **no possible render state** where the real Button is clickable while `message.trim()` is empty — the UI-level guard and the handler-level guard can never be observably decoupled through the real Button. To genuinely exercise `handleRequestChanges`'s own guard "with the button enabled" as instructed, the test remounts `PortalApprovalActions` (via `vi.resetModules()` + a scoped `vi.doMock("@/components/ui/button", ...)` that forwards `onClick` unconditionally while still rendering a `data-disabled` marker for inspection, then `vi.doUnmock` + `vi.resetModules()` afterward so all other tests keep using the real Button from the file's top-level import). This is a **test-only** technique — it does not touch `components/ui/button.tsx` and does not change what real users can do — and it is the only way to isolate the component's own guard from the UI library's independent (and, on inspection, fully sound) enforcement.
- No production defect was found for either assertion: AS-014's ref-clearing was already correctly in the `finally` block (the surviving mutant was a genuine test gap, now closed); AS-016's guard was already present and correctly blocks whitespace-only submissions — it is simply unreachable through the real UI today because the Button's own `disabled` prop makes it redundant-but-correct defense-in-depth. `approval-actions.tsx` is unmodified.

## Out-of-scope work needed
None beyond what scrutiny-2.md already lists for other in-flight workers (FU-I/FU-J/FU-K/FU-L on `lib/actions/portal-approval.ts`, `approve_portal_task_atomic`, and the realtime auth-hydration race) — none of that is F021's concern and none of those files were touched here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Moved the two new AS-014 tests to run before the existing AS-015 test in file order (pure reordering, no assertion logic changed on AS-015's own test) to avoid a cross-test React-transition-scheduler interaction discovered during mutation verification (see Decisions made). This does not touch the AS-015 test body, which stays exactly as F014 left it, per instructions.
AUTONOMOUS_DECISION: Used a scoped `vi.doMock`/`vi.resetModules` remount of `PortalApprovalActions` against a disabled-passthrough stub `Button`, test-file-local only, to reach `handleRequestChanges`'s guard with the real Button proven architecturally unable to expose that state (see Decisions made for the full trace through Base UI's `useButton` source).

## Notes for the next worker
- The repo has several other workers' in-flight, uncommitted changes in the working tree at the time of this task (`lib/actions/portal-approval.ts`, `next-env.d.ts`, a new migration under `supabase/migrations/`, `tests/unit/f022-board-realtime-guard-call-site.test.tsx`, `tests/unit/portal-approval-action.test.ts`, and untracked `missions/20260830-223927/**` / most of `missions/20260902-212300/**`). None of these were touched, staged, or committed by this task — only `components/portal/approval-actions.test.tsx` was staged and committed, verified via `git status --short` immediately before and after the commit.
- If a future worker touches `components/ui/button.tsx` (Base UI wrapper) in a way that changes how `disabled` is enforced (e.g. switching to native-attribute-only enforcement), re-check whether the `vi.doMock` stub in the AS-016 guard test is still necessary — it may become possible to simplify back to a plain `removeAttribute("disabled")` click.
