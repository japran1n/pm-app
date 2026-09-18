# Handoff: F028b — JS-tab → HTML prepend utility (M5 AS-015/016 blocker fix)

## Status
COMPLETE

## Assertions covered
AS-015: PASS — test_AS_015_inline_style_in_html_tab_flows_through_convert (build-convert-input.test.ts) verifies inline <style> in the HTML tab survives buildConvertInput() and flows through convert() to produce a Webflow style with the expected declaration. Component-level contract also re-verified by test_AS_015_html_tab_passes_inline_style_unchanged_to_onHtmlChange in converter-editor.test.tsx (renamed for clarity, same assertions).
AS-016: PASS — test_AS_016_js_tab_content_injected_as_script_block (build-convert-input.test.ts) verifies buildConvertInput() prepends JS-tab content as a <script> block and that convert() picks it up into customCode.scripts. test_AS_016_empty_js_returns_html_unchanged covers the no-op case. Component-level contract also re-verified by test_AS_016_html_tab_passes_inline_script_unchanged_to_onHtmlChange in converter-editor.test.tsx (renamed for clarity, same assertions).

## Files changed
components/webflow-tool/build-convert-input.ts
components/webflow-tool/build-convert-input.test.ts
components/webflow-tool/converter-editor.test.tsx

## Commands run
`npx vitest run components/webflow-tool/build-convert-input.test.ts` (0)
`npx vitest run components/webflow-tool/` (0, 6 files / 35 tests passed)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Implemented buildConvertInput() exactly per the spec's given code: trims JS, returns html unchanged when JS is empty/whitespace-only, otherwise prepends a `<script>...</script>` block ahead of the html string. This matches the architecture decision documented in lib/webflow-converter/convert.ts's docstring (AS-101/AS-016): convert() has no `js` parameter by design — the UI layer must combine JS-tab content into the HTML as <script> tags before calling convert().
- Added `import { expect, it } from "vitest"` to build-convert-input.test.ts because this repo's vitest config does not enable global test APIs (confirmed by an initial `ReferenceError: it is not defined` failure) — all sibling test files in this directory follow the same explicit-import pattern.
- Renamed the two AS-015/AS-016 tests in converter-editor.test.tsx per the task's exact instructions to test_AS_015_html_tab_passes_inline_style_unchanged_to_onHtmlChange and test_AS_016_html_tab_passes_inline_script_unchanged_to_onHtmlChange — behavior and assertions unchanged, only clarifying that these test the component's pass-through contract, not the full engine path (which is now covered by build-convert-input.test.ts).

## Out-of-scope work needed
F031 (or whichever M6 feature wires ConverterEditor to the convert() server action) still needs to actually call buildConvertInput(html, js) before invoking convert() — this handoff only delivers the utility and its tests, not the caller wiring, per the task's explicit scope ("M6/F031 will call convert(), but it needs this helper").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — implementation followed the exact code given in the task spec)

## Notes for the next worker
- lib/webflow-converter/convert.ts's docstring (lines 25-44) is the canonical architecture rationale for why convert() takes no `js` param — read it before touching convert() or this utility.
- No MCP tools were used; this is a pure, local TypeScript utility with no external service dependency.
