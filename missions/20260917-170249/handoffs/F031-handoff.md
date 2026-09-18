# Handoff: F031 — Convert button wired to server action

## Status
COMPLETE

## Assertions covered
AS-023: PASS — Convert button renders with ⌘/Ctrl+Enter shortcut; both trigger `convertHtmlToWebflow`.
AS-024: PASS — Button is disabled and shows "Paste some HTML first." (title + inline text) when HTML editor is empty.
AS-025: PASS — Button shows "Converting…" and is disabled while the action promise is pending.
AS-026: PASS — On success shows "✓ X elements · Y classes · Z KB" using stats.nodeCount, stats.styleCount, and json.length/1024 rounded to 1 decimal.
AS-028: PASS — On error (`result.ok === false`) shows `result.message` inline via a `role="alert"` paragraph.

## Files changed
components/webflow-tool/converter-page.tsx
components/webflow-tool/converter-page.test.tsx
lib/actions/webflow-converter.test.ts
components/webflow-tool/build-convert-input.ts (deleted)
components/webflow-tool/build-convert-input.test.ts (deleted)

## Commands run
`npx vitest run components/webflow-tool/ lib/actions/webflow-converter.test.ts` (0, 46 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Resolved the JS-injection duplication by keeping `withInjectedScript` inside `lib/actions/webflow-converter.ts` (server-side, already wired to `input.js`) and deleting the client-side `components/webflow-tool/build-convert-input.ts` utility, since the spec said to pick one and the action already does the injection before calling `convert()`. The old `build-convert-input.test.ts` coverage (AS-016 injection behaviour, empty-js passthrough) was ported into `lib/actions/webflow-converter.test.ts` as `test_AS_016_js_tab_content_is_injected_as_a_script_block_before_convert` and `test_AS_016_empty_js_leaves_html_unchanged`, asserting through the public `convertHtmlToWebflow` action instead of the removed helper.
- `handleConvert` guards against empty HTML and concurrent calls (`if (html.trim() === "" || loading) return`) so the keyboard shortcut can't double-fire or bypass the empty-state disable.
- Byte size computed as `Math.round((result.json.length / 1024) * 10) / 10` per the DoD spec, displayed as "Z KB" (note: this is a string-length approximation, not actual UTF-8 byte size — acceptable per spec wording which explicitly gave this formula).
- Added `data-testid="conversion-result"` / `data-ok` passthrough div as instructed, for F033-F036 to consume `result` without re-deriving it.
- Used the existing `Button` component (`variant="primary"`) rather than a raw `<button>` to stay consistent with the Supabase design system button anatomy already in the codebase.

## Out-of-scope work needed
- Warnings display (non-blocking warnings from `result.warnings`) is not shown yet — that's F032's scope per the placeholder comment (F031-F036).
- Copy-to-clipboard buttons and the verify-clipboard box (F033-F036) are not implemented here; the `result` state and `conversion-result` test hook are exposed for them to consume.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Consolidated JS-injection logic into the server action (`withInjectedScript` in `lib/actions/webflow-converter.ts`) rather than the client-side `buildConvertInput` helper, since the action already accepted `js` as a parameter and the spec allowed either fixed target — "simplest: the action prepends the JS script block to HTML before calling convert() internally" was explicitly suggested in the spec and matched the action's existing (already-implemented) behavior, requiring the fewest changes.

## Notes for the next worker
- `ConvertActionResult` is exported from `lib/actions/webflow-converter.ts` and now imported by `converter-page.tsx` for typing the `result` state — reuse this type in F033-F036 rather than redefining it.
- The Convert button lives in the `{/* F031-F036 */}` section of `converter-page.tsx`; keep appending sibling elements there (warnings list, copy buttons, verify box) rather than restructuring the existing stats/error block.
- No MCP tools were used — this is a pure client-component / server-action wiring task with no live external service state to inspect.
