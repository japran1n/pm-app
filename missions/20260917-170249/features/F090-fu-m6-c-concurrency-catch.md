# F090: M6 follow-up C — concurrency safety + server action catch (AS-025, D4/D5)

**Milestone:** M6 follow-up
**Depends on:** F031

## Assertion IDs covered
- AS-025: Only one conversion can be in flight at a time (rapid ⌘⏎ cannot issue two requests)

## Clarified implementation

In `components/webflow-tool/converter-page.tsx`:

1. Replace the closure-captured `loading` guard in the keyboard handler with a `useRef` in-flight flag (`inFlight.current`). Set it `true` at the start of `handleConvert`, `false` in `finally`. Both the keyboard shortcut and the button click check this ref.

2. Add a monotonically increasing request-sequence token (a `useRef<number>` counter). Capture the current token at request start; in the finally, only call `setResult` if the token still matches (discard stale responses).

3. Add a `catch` to `handleConvert` that converts a rejected Server Action into a visible `ok:false` result: `setResult({ ok: false, message: "Conversion failed — please try again.", warnings: [], errors: [] })`. Clear any stale `copyStatus` to `"idle"` in the same catch.

Also fix D7: clear the `copyStatus` setTimeout on unmount in `converter-page.tsx`.
Also fix D9: replace `aria-label="Convert"` override with `aria-busy={loading}` on the button.
Also fix D8 (from converter-results): render "Copy failed" text on custom-code copy error state.

Tests to add:
- Rapid double ⌘⏎ fires only one server action call
- Out-of-order resolution keeps the newer result (mock two actions with controllable resolve order)
- A rejecting server action shows an error, clears copy status

## Definition of done
- `inFlight` ref prevents double-submission via keyboard
- Request sequencing discards stale responses
- Rejected Server Action surfaces as visible error
- Three tests covering the above
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed
