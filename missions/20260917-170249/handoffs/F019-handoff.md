# Handoff: F019 — emit js extraction

## Status
COMPLETE

## Assertions covered
AS-101: PASS — inline <script> content is extracted into the scripts array (test_extracts_inline_script_content)
AS-102: PASS — external script src produces a warning and no content (test_warns_about_external_script_src)
AS-103: PASS — mixed inline+external scripts: inline content extracted, external warned (test_extracts_inline_scripts_and_warns_about_external_scripts_together)
AS-104: PASS — no scripts → empty scripts array, no warnings (test_returns_an_empty_scripts_array_and_no_warnings_when_there_are_no_scripts)
AS-105: PASS — empty HTML input → empty result of the same shape, not undefined/null (test_returns_empty_result_of_the_same_shape_for_empty_input)
AS-107: PASS — inline <style> block content extracted via extractStyles (test_extracts_inline_style_block_content)
AS-108: PASS — no style blocks → empty styles array (test_returns_an_empty_styles_array_when_there_are_no_style_blocks)
AS-109: PASS — never throws for malformed/unclosed script markup (test_never_throws_for_malformed_input)
AS-110: PASS — empty styles result matches populated shape (test_returns_empty_result_of_the_same_shape_for_empty_input, extractStyles variant)
AS-134: PASS — no GSAP CDN auto-injection, no plugin detection anywhere in js-extract.ts (verified by code review — grep for "gsap"/"cdn" returns nothing in the new file)

## Files changed
lib/webflow-converter/js-extract.ts
lib/webflow-converter/js-extract.test.ts

## Commands run
`npx vitest run lib/webflow-converter/js-extract.test.ts` (0)
`npx vitest run lib/webflow-converter/` (0, 308 tests passed across 7 files)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Implemented as two standalone pure functions (`extractScripts`, `extractStyles`) rather than folding into emit.ts, matching the clarified spec's "single exported pure function per concern" pattern and the file name `js-extract.ts` implied by the feature title.
- Used `node-html-parser`'s `querySelectorAll` + `childNodes` text-node collection (same library already used by emit.ts/css.ts) rather than regex, for parity with the rest of the engine's parsing approach and correctness on malformed markup.
- Deliberately did NOT port the prototype's GSAP CDN auto-injection or plugin detection logic (per this feature's explicit "Draft scope" note and AS-134) — this is a pure extract-and-warn pass only.
- External `<script src="...">` never contributes to `scripts` output, only to `warnings`, per assertion text ("not included").
- Empty/no-match inputs return `{ scripts: [], warnings: [] }` / `{ styles: [], warnings: [] }` — never undefined/null — per the clarified "Empty / zero state" answer.
- Functions never throw; parse errors on malformed HTML are absorbed by node-html-parser's lenient parsing (verified with an explicit test), consistent with the clarified "Failure / error handling" answer.

## Out-of-scope work needed
- Wiring `extractScripts`/`extractStyles` output into the actual conversion pipeline / UI display (e.g. showing the extracted JS/CSS to the user, combining with emit.ts's payload) is not part of this feature's "Files" line and was left untouched — a future feature should consume these two functions from wherever the convert pipeline or UI needs the extracted custom-code text.
- Linked external stylesheets (`<link rel="stylesheet">`) are out of scope per the spec ("these are separate from linked stylesheets") and were not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the two exported functions `extractScripts` and `extractStyles` (spec's exact wording) and kept both in one file since the spec's "Files (approximate)" line named convert.ts/convert.test.ts but the task instructions explicitly directed lib/webflow-converter/js-extract.ts — followed the explicit task instructions (more specific/authoritative) over the spec's approximate file list, consistent with "Module boundaries: the named file is the target."

## Notes for the next worker
- No MCP usage — this feature has "MCP at run: none" and is pure library code with no external service touchpoints.
- `node-html-parser`'s `rawText` on text nodes preserves original script/style text verbatim (no HTML-entity decoding), which matches the "pass through exactly as written" validation rule.
- Full webflow-converter test suite (7 files, 308 tests) remains green after this addition — no existing files were modified.
