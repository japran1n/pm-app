# F088: M6 follow-up A — AS-033 paste instruction after copy

**Milestone:** M6 follow-up
**Depends on:** F034

## Assertion IDs covered
- AS-033: After a successful "Copy for Webflow" write, the user is shown explicit instructions to open Webflow Designer, click the canvas, and paste.

## Clarified implementation

After `handleCopyWebflow` succeeds (`copyStatus === "success"`), render a persistent confirmation region (not just the transient button label) that tells the user:
1. Open the Webflow Designer
2. Click on the canvas to focus it
3. Press Cmd/Ctrl+V to paste

This region must:
- Use `role="status"` so assistive tech announces it
- Not appear when the copy failed
- Be a sibling of the copy button, below it, inside `converter-page.tsx`

Also fix D12: add a page-level test in `converter-page.test.tsx` asserting `<ConverterVerify />` and Safari note mount (i.e. deleting the component would fail the test).

## Definition of done
- `converter-page.tsx` renders Designer/canvas/paste instruction when `copyStatus === "success"` 
- Test asserts presence of text matching "Designer" and "paste" on success
- Test asserts the instruction is absent when `copyStatus !== "success"`
- Test asserts `ConverterVerify` is rendered (anti-regression)
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed
