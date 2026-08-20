# Handoff: F284 — screenshot region select

## Status
COMPLETE

## Assertions covered
AS-540: PASS — `extension/tests/region-select.spec.ts` proves (a) the user can drag-select a region over the already-captured screenshot and get a real, correctly-cropped, correctly-dimensioned PNG (`AS_540_user_can_select_and_crop_a_region_instead_of_the_whole_capture`), (b) the crop math correctly applies F283's `devicePixelRatio` when mapping the CSS-pixel drag rect onto the physical-pixel PNG (`AS_540_region_selection_respects_device_pixel_ratio_when_cropping`, dpr=2 case), and (c) Escape cancels the selection flow cleanly — no stray overlay, no crash, the underlying full capture and popup remain fully usable afterward (`AS_540_escape_cancels_region_selection_without_a_stray_overlay_or_crash`).

## Files changed
extension/src/capture/crop.ts (new)
extension/src/capture/RegionSelect.tsx (new)
extension/src/popup/Popup.tsx (wired region-select states: captured -> selecting -> cropped/back-to-captured)
extension/tests/region-select.spec.ts (new)

## Commands run
`npx playwright test tests/region-select.spec.ts` (extension/, 0 — 3/3 passed)
`npm run build` (extension/, 0 — includes check-no-secret-key.mjs AS-538 re-check, PASS)
`npx playwright test` (extension/, 0 — full suite, 15/15 passed, confirms F280-F283 tests still pass)
`npx tsc --noEmit` (extension/, 0)
`npx eslint .` (extension/, 0)
`npx tsc --noEmit` (app root, 0)
`npx eslint .` (app root, 0 errors — 1 pre-existing unrelated warning in lib/queries/search.ts)

## Decisions made
- **Region selection is a popup-side UI drawn over the already-captured static PNG, not a content-script overlay injected into the live page.** This was the real design decision the spec left open. Chose this over a live-page overlay for three concrete reasons: (1) it makes the "overlay must never appear in its own screenshot" requirement structurally impossible to violate — selection only starts after `chrome.tabs.captureVisibleTab` has already resolved, so nothing is ever drawn on the page at capture time, with no popup/content-script race or "hide before resolve" timing to get right; (2) it adds zero new permissions or `content_scripts` manifest entries — a live-page overlay would need to inject a script into whatever arbitrary origin the user is on, which conflicts with tech-decisions.md's narrow `activeTab`-only stance (the existing `content_scripts` entry is scoped only to `localhost:3000/extension-connect*`, not general web pages); (3) it reuses the exact popup/messaging-free flow F283 already built (button click -> `captureVisibleTab()` -> result held in local React state / `store.ts`) with no new message-passing contract between popup and content script to design and debug. This is the "simpler, more robust" choice per the clarification's tie-breaker.
- **Crop is applied to F283's existing full-tab capture only — no second `chrome.tabs.captureVisibleTab` call anywhere in this feature.** `cropDataUrlToRegion` in `crop.ts` takes the same `capture.dataUrl` F283 already produced and crops it via a canvas `drawImage` source-rect call; `Popup.tsx`'s "Select region…" button only reads the already-stored `CapturedScreenshot`, never re-triggers capture. This satisfies the spec's explicit "so the two paths cannot diverge" requirement.
- **devicePixelRatio mapping:** the region-select preview `<img>` is displayed at CSS-pixel size = `naturalWidth/naturalHeight ÷ devicePixelRatio` (i.e. "true to page size", matching how the page looked live before the physical-pixel capture was taken). This is what makes multiplying a CSS-pixel drag rect by `devicePixelRatio` (`cssRectToPhysicalRect` in `crop.ts`) land exactly on the physical-pixel PNG's coordinate space — using exactly the number F283 recorded for this purpose, per its own handoff note. Verified for real in the dpr=2 test case (60x40 CSS-pixel selection -> 120x80 physical-pixel cropped PNG).
- **"Escape cancels the whole flow" is interpreted as: cancel the in-progress/region-select overlay entirely, returning to the plain full-tab capture state with no crop applied** (equivalent to clicking "Use full screenshot") — not discarding the underlying capture itself. This matches the spec's own fallback note ("capture full view, then crop in the annotation stage" is a legitimate no-selection outcome) and keeps AS-539's full-capture path always reachable/undisturbed.
- **Dimmed backdrop implemented via the CSS `box-shadow: 0 0 0 9999px rgba(...)` "spread" trick on the selection rect itself**, rather than a separate full-size dimming overlay element — avoids a second element that would otherwise sit on top of (and block pointer events for) the drag rectangle, while still visually dimming everything outside the selection.
- **Live width x height readout is in CSS pixels** (matching what the user visually drags over), rounded to whole numbers for display; the actual crop happens in rounded physical pixels via `cssRectToPhysicalRect`.
- Reused the exact Playwright harness pattern and stub approach from `capture-visible-tab.spec.ts` (`chrome.tabs.captureVisibleTab`/`chrome.tabs.query` stubbed with a real Playwright-taken screenshot, since a real `activeTab` toolbar-icon click cannot be scripted in this harness) — see that file's header comment, reused verbatim reasoning in `region-select.spec.ts`'s header. Also stubbed `window.devicePixelRatio` via `addInitScript` (a legitimate, ungrantable-nothing browser property override, not a stub of any of this feature's own logic) so the dpr=2 crop-mapping test is deterministic and portable across whatever display runs CI.

## Out-of-scope work needed
- Uploading the (full or cropped) captured PNG to the attachments bucket / task-creation Route Handler — still deferred to a later M19 feature per tech-decisions.md, unaffected by this feature.
- The annotation-stage UI mentioned in the spec's fallback note ("capture full view, then crop in the annotation stage") is a separate, later feature; this feature's region-select is an alternative path available immediately after capture, not a replacement for that later stage.
- No keyboard-only way to *initiate* a drag-select (arrow-key region adjustment, etc.) was built — the spec's keyboard-only alternative is explicitly "skip region select, capture full view instead," which already works unchanged; a fully keyboard-driven region-select (if ever desired) is new scope, not implied by AS-540.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the popup-side static-image selection UI over a live-page content-script overlay, per the clarification's "simpler, more private/narrower" tie-breaker and the concrete permission/messaging-complexity reasons listed above under Decisions made — this was the one specifically-flagged open design decision in the task instructions, and no clarification answer named one approach explicitly, so the tie-breaker's "simpler, more robust" criterion controlled the choice.
AUTONOMOUS_DECISION: On crop failure (e.g. a degenerate zero-size region after clamping to image bounds) the region-select UI shows an inline error (`data-testid="region-select-error"`) and stays in the selecting state rather than silently discarding the drag — matches the clarification's "every failure states what happened and preserves the reporter's work; no silent no-ops" standing answer. Not separately assertion-covered (AS-540 doesn't test this path) but included since the clarification's failure-handling answer applies broadly.

## Notes for the next worker
- `extension/src/capture/store.ts`'s `CapturedScreenshot` type and `setLastCapture`/`getLastCapture` are untouched — this feature only reads the capture the popup already holds in local state; it does not write a second, "cropped" variant into `store.ts`. A later feature building the annotation/upload stage should decide whether it wants the full capture, the last-confirmed crop, or both — currently only the full capture is in `store.ts`; the cropped result lives only in `Popup.tsx`'s local `captureState`. If the annotation-stage feature needs the cropped image to survive past this popup mount the same way the full capture does, it will need to either read it from `Popup.tsx`'s render tree directly or add a second `store.ts` slot — flagging so it isn't a surprise.
- MCP usage: none (pure client-side browser API feature, no external service state to introspect, matching the feature spec's "MCP at run: none").
- Real API used for cropping: `HTMLCanvasElement`/`CanvasRenderingContext2D.drawImage` 9-argument source/dest-rect overload (https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage, verified 2026-08-20) plus `HTMLCanvasElement.toDataURL('image/png')` — no new dependency added.
