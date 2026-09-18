# F096: M6 follow-up M — reset copyStatus on re-conversion

**Milestone:** M6 follow-up
**Depends on:** F031

## Issue to fix

`converter-page.tsx`: after a successful copy, if the user edits the HTML and converts again, `copyStatus` stays `"success"` — the button still says "Copied!" and the paste instruction is still on screen, but they now point at the previous payload. Only the `catch` branch resets it; the success branch does not.

## Clarified implementation

In `converter-page.tsx`, at the START of `handleConvert` (before the try block), reset `copyStatus` to `"idle"`:
```ts
setCopyStatus("idle");
```

This ensures every new conversion clears any stale copy state before the new result arrives.

Also clear any pending copyStatus timeout on a new conversion start.

Test to add in `converter-page.test.tsx`:
- `test_copystatus_reset_on_reconvert`: 
  1. Mock `writeToClipboard` returning true + `convertHtmlToWebflow` returning success
  2. Fire Copy → `copyStatus` becomes "success", paste instruction visible
  3. Fire Convert again (second call to `handleConvert`)
  4. Assert "Copied!" is gone and paste instruction is gone during the second conversion

## Definition of done
- `copyStatus` reset to "idle" at the start of each `handleConvert`
- Test asserts stale "Copied!" and paste instruction disappear on re-conversion
- `tsc --noEmit` clean, vitest pass, lint clean, committed
