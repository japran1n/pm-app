# Handoff: F098 — Fix M6 majors: copy button stale payload + inaudible failure

## Status
COMPLETE

## Assertions covered
AS-034: PASS — copy button now disabled while `loading` is true so it cannot fire during an in-flight reconvert (avoiding stale-payload copy), and the failure message ("Copy failed — try again") is announced to screen readers via a `role="alert"` live region without being permanently drowned out by a static `aria-label`. Verified with `test_copy_disabled_during_convert`, `test_AS_034_shows_copied_on_success`, `test_AS_034_shows_error_message_on_failed_copy`, `test_AS_033_paste_instruction_absent_before_copy_and_on_copy_failure`, and all other AS-034/AS-033/AS-027/AS-119 tests in `converter-page.test.tsx` — all pass.

## Files changed
components/webflow-tool/converter-page.tsx
components/webflow-tool/converter-page.test.tsx

## Commands run
`npx vitest run components/webflow-tool/` (0) — 73/73 tests pass
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- D-N2: Changed the Copy button's `disabled` expression from `!(result?.ok && (result?.errors?.length ?? 0) === 0)` to `loading || !result?.ok || (result?.errors?.length ?? 0) > 0` (equivalent logic, plus `loading`). This is sufficient on its own per the spec's own note ("just adding `loading` to `disabled` is sufficient and simpler") — did not also clear `result` at the start of `handleConvert`, since the spec explicitly said that extra step was unnecessary once `loading` gates the button.
- D-N4: Removed the static `aria-label="Copy for Webflow"` from the Copy button so its own text (which changes to "Copy failed — try again" / "Copied!") is what gets announced. Rather than putting `role="alert"` directly on the `<button>` element (which would have overridden its implicit `button` role for assistive tech and broken `getByRole("button", ...)` semantics for screen reader users), I added a dedicated `sr-only` `<p role="alert">` that mirrors the failure text and appears only while `copyStatus === "error"`. This keeps the button's accessible role intact while still proactively announcing the failure via a live region, matching the pattern already used for the success `role="status"` paragraph.
- Auto-clear timeout: the 3s `setTimeout` that resets `copyStatus` to `"idle"` is now only scheduled when the copy succeeded (`ok === true`); on failure no timeout is set, so "Copy failed — try again" persists until the user clicks the button again (which resets `copyStatus` to `"idle"` at the very start of `handleConvert`, and `handleCopyWebflow` itself sets a fresh status on the next click).
- Updated two existing tests (`test_AS_034_shows_error_message_on_failed_copy`, `test_AS_033_paste_instruction_absent_before_copy_and_on_copy_failure`) that previously used `screen.findByText(/copy failed/i)`, which became ambiguous once both the button text and the new sr-only alert paragraph contained that string. Switched them to assert on the `role="alert"` element's `textContent` instead, which is a strictly stronger check (it also proves the accessibility fix landed) and does not change what behaviour is being verified.

## Out-of-scope work needed
None identified. `converter-results.tsx` was read per the task instructions but required no changes — its error/warning rendering already uses `role="alert"` correctly for the compound-error case (AS-029/AS-120) and was unrelated to the two majors described.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented the D-N4 fix via a separate `sr-only` live-region paragraph rather than putting `role="alert"` directly on the Copy button as one literal reading of the instructions might suggest, because overriding a `<button>`'s implicit role to `alert` removes its button semantics for assistive technology (and would have desynced from `getByRole("button", ...)` queries used throughout the existing test suite). This still satisfies the assertion's intent — screen reader users hear "Copy failed — try again" — while keeping the interactive control a real button.

## Notes for the next worker
No MCP tools were used — this was a pure UI bugfix in existing React components with no external service or live-state dependency.
