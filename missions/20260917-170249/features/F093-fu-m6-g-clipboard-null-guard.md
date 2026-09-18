# F093: M6 follow-up G — clipboard null-guard + execCommand catch (D-M1, D-M2)

**Milestone:** M6 follow-up
**Depends on:** F089

## Issues to fix

**D-M1** `clipboard.ts`: `e.clipboardData?.setData(...)` with optional chaining means a null `clipboardData` makes every setData a silent no-op while `fired=true, threw=false` — returns `true`, UI shows "Copied!" over an empty clipboard.

**D-M2** `clipboard.ts`: `try/finally` wraps `execCommand` but has no `catch`. A throwing `execCommand` escapes the handler and `setCopyStatus("error")` never runs.

## Clarified implementation

In `lib/webflow-converter-client/clipboard.ts`:

1. Change `e.clipboardData?.setData(...)` to guard explicitly: if `!e.clipboardData` set `threw = true` and return early (inside the handler), so `fired` stays false or the throw flag prevents returning true.

2. More simply: check `if (!e.clipboardData) { threw = true; return; }` at the top of the copy handler before any setData calls.

3. Wrap the `document.execCommand("copy")` call itself in a try/catch: on throw, set `threw = true` and set `result = false`.

4. Also handle the empty-items case: if `items.length === 0`, return `false` immediately before adding the listener (nothing to write).

Tests to add in `clipboard.test.ts`:
- `test_null_clipboardData_returns_false`: dispatch copy event with `clipboardData = null` → `writeToClipboard` returns `false`
- `test_execCommand_throws_returns_false`: make `document.execCommand` throw → returns `false`
- `test_empty_items_returns_false`: call `writeToClipboard([])` → returns `false` without touching the clipboard

## Definition of done
- Null `clipboardData` returns `false`
- Throwing `execCommand` returns `false`
- Empty items returns `false` immediately
- Three tests covering the above
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed
