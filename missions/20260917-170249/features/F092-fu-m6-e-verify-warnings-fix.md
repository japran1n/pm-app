# F092: M6 follow-up E — verify box absent case + warnings cap (AS-036, AS-120)

**Milestone:** M6 follow-up
**Depends on:** F032, F036

## Assertion IDs covered
- AS-036: Verify box reports when application/json is absent (not just present)
- AS-120: All warnings are reachable — warnings 4..n must not silently vanish

## Clarified implementation

### AS-036: converter-verify.tsx absent case
Add a distinct status line in the verify output that shows "application/json: PRESENT" or "application/json: NOT PRESENT" — so the user immediately knows whether the Webflow payload is on the clipboard without having to scan a MIME list.

Test the absent case: simulate a paste with only `text/plain` data (no `application/json`). Assert "NOT PRESENT" text renders.

### AS-120: warnings cap in converter-results.tsx
Two options:
1. Remove the 3-warning cap entirely; render all warnings in a `max-h-40 overflow-y-auto` scroll container
2. Keep the expander but: (a) reset `showAllWarnings` to `false` whenever `result` changes (useEffect), and (b) add a test with 5 warnings asserting all 5 are visible after expanding

Choose option 1 (scroll container, no cap) — simpler, no hidden state.

Also fix D6 (FU-F AS-119 hardening): gate both copy paths on `result.ok && (result.errors?.length ?? 0) === 0` instead of just `result.ok`. Render `result.errors` in `ConverterResults` whenever non-empty, regardless of `ok`.

Also fix AS-038: trim custom code before the non-empty check — `customCode.join("\n\n").trim().length > 0`.

## Definition of done
- Verify box shows explicit "application/json: PRESENT/NOT PRESENT" line
- Test asserts "NOT PRESENT" when no application/json in paste
- Warnings render without cap (scroll container)
- Both copy paths gate on `ok && errors.length === 0`
- Custom code trimmed before non-empty check
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed
