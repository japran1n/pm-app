# Handoff: M7-ux-fixes-2 — Preview overflow + stale results fix

## Status
COMPLETE

## Assertions covered
This is a defect-fix task (D1 blocker + O1 non-blocking) identified by the UX validator, not a new feature with newly assigned assertion IDs. No new/changed assertion IDs were assigned in `validation-contract.md`. Existing preview/results assertions continue to pass per the full test suite run below.

## Files changed
components/webflow-tool/converter-preview.tsx
components/webflow-tool/converter-page.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run components/webflow-tool/` (0) — 7 files, 80 tests passed

## Decisions made
- D1: Removed `min-h-[400px]` from the iframe itself (`converter-preview.tsx`); the iframe now uses `h-full min-h-0 w-full`. Moved the minimum-height constraint to the preview COLUMN wrapper in `converter-page.tsx` (`min-h-[250px] min-w-0 flex-1 overflow-hidden`), matching the spec's guidance to keep min-height at the column level and add `overflow-hidden` so the iframe can never bleed past its assigned area.
- O1: Added `handleHtmlChange` / `handleCssChange` wrapper functions in `converter-page.tsx` that call the underlying `setHtml`/`setCss` plus `setResult(null)` and `setCopyStatus("idle")`, then wired them into `ConverterEditor`'s `onHtmlChange`/`onCssChange` props (replacing the raw `setHtml`/`setCss` references). This clears stale conversion results and disables the Copy button as soon as the user edits HTML or CSS after a conversion, per the spec. Left `onJsChange={setJs}` untouched since the spec only called out HTML and CSS inputs.

## Out-of-scope work needed
None identified beyond the two defects in scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `min-h-[250px]` for the preview column as a "sensible minimum" per the spec's 200-300px guidance range, matching typical preview panel sizing already used elsewhere in the app.

## Notes for the next worker
- No MCP tools were needed for this fix — purely local UI/layout and React state changes, no external service touched.
- The full webflow-tool test suite (7 files / 80 tests) was run and passes; no new tests were added since this is a defect-repair task with no new assertions attached, and the existing suite already exercises the preview and results components without regressions.
