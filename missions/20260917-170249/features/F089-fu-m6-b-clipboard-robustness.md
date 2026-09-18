# F089: M6 follow-up B — clipboard.ts robustness (AS-031/032/034)

**Milestone:** M6 follow-up
**Depends on:** F033

## Assertion IDs covered
- AS-031: Both `application/json` and `text/plain` are written to the clipboard
- AS-032: Synchronous copy-event trick is used (no async Clipboard API)
- AS-034: Copy failure renders "Copy failed — try again"

## Clarified implementation

Rewrite `lib/webflow-converter-client/clipboard.ts` so the boolean return means "payload is provably on the clipboard":

1. Add a `fired` boolean flag set to `true` inside the copy handler before `setData` calls
2. Wrap each `setData(mimeType, data)` in try/catch; treat any throw as total failure (set a `threw` flag)
3. Always `removeEventListener(handler)` in a `finally` block — never leave the listener alive
4. Return `execCommand_result && fired && !threw`

Also fix D11: add a rationale comment above `document.execCommand` explaining WHY this deprecated API is used (it's the only way to set `application/json` MIME type — the async Clipboard API refuses it).

Tests to add in `clipboard.test.ts`:
- `execCommand` returns `true` without dispatching the copy event → `writeToClipboard` returns `false`
- `setData` throws on `application/json` → `writeToClipboard` returns `false`
- Listener is removed in every outcome (verify using a `removeEventListener` spy)

## Definition of done
- `writeToClipboard` returns `false` if `fired` is never set (copy event never fired)
- `writeToClipboard` returns `false` if any `setData` throws
- Listener always removed regardless of outcome
- Three new tests covering the above paths
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed
