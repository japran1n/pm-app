# Handoff: F017 — html typemap images embeds

## Status
COMPLETE

## Assertions covered
AS-086: PASS — inline `<svg>` maps to `type: "HtmlEmbed"` with `data.html` set to the raw outerHTML verbatim, no element children.
AS-087: PASS — `<video>` and `<iframe>` map to `type: "HtmlEmbed"` with a warning.
AS-088: PASS — unrecognized tag (`marquee`) maps to `type: "Block", tag: "div"` with a warning naming the tag (pre-existing default branch, re-verified with a new test).
AS-095: PASS — `<img>` maps to `type: "Image"` with no `src` wired into the returned data.
AS-096: PASS — `alt` attribute preserved on `data.alt` when present.
AS-097: PASS — `data` has no `alt` key when the source `<img>` has no `alt` attribute (never invented).
AS-098: PASS — warning string names the original `src` (`img element for /shot.png left empty — upload manually.`).
AS-099: PASS — test strips the `warning` field and asserts `JSON.stringify` of the remaining payload never contains the src string.
AS-100: PASS — two images with different `src` values produce two distinct warning strings, each naming its own URL.

## Files changed
lib/webflow-converter/typemap.test.ts

## Commands run
`npx vitest run lib/webflow-converter/typemap.test.ts` (0) — 28 passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- On inspecting `lib/webflow-converter/typemap.ts`, the img/svg/video/iframe branches this feature specifies were already implemented (committed under the prior F016 commit `b2035a89`), matching this feature's spec byte-for-byte: `Image` type with no `src` in the payload, warning naming the dropped src, `svg` -> `HtmlEmbed` carrying raw `outerHTML`, `video`/`iframe` -> `HtmlEmbed` + warning, unknown tag -> `Block` + warning naming the tag. No production code changes were needed; this feature's remaining work was adding the assigned assertion tests, which were missing.
- Followed the feature spec's own note verbatim over the generic task prompt's differing shape (`EmbedComponent`/`TypeMapResult.warnings[]`): the mission's actual clarified spec (F017 spec file) and validation-contract.md (AS-086/087) specify `HTML Embed` (implemented as `type: "HtmlEmbed"`, matching the reference prototype's naming) and a single `warning` string field consistent with the rest of `typemap.ts`, not an array. The mission spec is the source of truth per instructions; the generic task-prompt shape was a mismatched template and was not followed where it conflicted.
- Test for AS-099 (src never appears in the payload) destructures out `warning` and JSON-stringifies the remainder to prove the src string appears nowhere else, directly testing the assertion's behavior rather than the implementation.

## Out-of-scope work needed
None identified beyond this feature's scope. `audio`, `embed`, `object`, and `canvas` tags are not covered by this feature's assertion IDs (AS-086/087/088/095-100 only name svg/video/iframe/img/unknown) and were left as-is falling through to the existing default `Block`-with-warning branch, consistent with "Edge-case scope: only what the assigned assertion IDs require."

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the existing `warning?: string` single-field shape and `HtmlEmbed` type name (matching the sibling F016 code already in typemap.ts and the reference prototype) rather than switching to the task prompt's `EmbedComponent`/`warnings[]` shape, since the feature spec file and validation-contract.md are the binding source of truth and both name "HTML Embed" + a warning, and the file already had a consistent single-`warning`-field convention used across all other branches (button, form, link, etc).

## Notes for the next worker
- `lib/webflow-converter/typemap.ts` already contains the img/svg/video/iframe/default branches needed for this feature (apparently added as part of the F016 commit). If a future audit feature (e.g. F039) diffs commits against features, note that F017's functional code landed in commit `b2035a89` (labeled as F016) rather than in this feature's own commit; this handoff commit (`902e85c6`) only adds the missing test coverage.
- No MCP usage — this is a pure function with no external service dependency, matching mcp: none in the spec.
