# Handoff: F283 — screenshot capture (visible tab)

## Status
COMPLETE

## Assertions covered
AS-539: PASS — `extension/tests/capture-visible-tab.spec.ts::AS_539_capture_control_screenshots_the_visible_area` proves the popup decodes and renders a real, correctly-dimensioned PNG (IHDR-decoded width/height, PNG magic bytes) from real Playwright-captured on-screen content.
AS-541: PASS — `extension/tests/capture-visible-tab.spec.ts::AS_541_capture_on_a_restricted_page_explains_why_instead_of_failing_silently` proves a real navigation to `chrome://extensions` produces a specific, non-generic explanation naming the restricted-page reason, not a bare "failed"/"error".

## Files changed
extension/src/capture/visible-tab.ts (new)
extension/src/capture/store.ts (new)
extension/src/popup/Popup.tsx (added Capture button + result/error UI, wired to visible-tab.ts)
extension/tests/capture-visible-tab.spec.ts (new)

## Commands run
`npx tsc --noEmit` (extension/, 0)
`npx eslint .` (extension/, 0)
`npx tsc --noEmit` (app root, 0)
`npx eslint .` (app root, 0 errors — 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run build` (extension/, 0 — includes check-no-secret-key.mjs, PASS)
`npx playwright test` (extension/, 12/12 passed, includes AS_538 no-secret-key re-check against the fresh build)

## Decisions made
- **Capture control lives in the popup, not the background worker or a side panel** — matches tech-decisions.md's explicit rationale (`activeTab` capture is documented reliable only from the popup). The button is rendered whenever the popup isn't in its initial `loading` state, independent of connection status: capturing the visible tab only needs `activeTab`, not an authenticated session — auth only matters once a later feature files the task from the captured image.
- **Device pixel ratio recorded alongside the capture** (`window.devicePixelRatio`, read at capture time in the popup document): per the clarification's "simpler/narrower" tie-breaker, this is the one number a later annotation feature would otherwise have to rediscover to map CSS-pixel overlay coordinates onto the physical-pixel PNG `captureVisibleTab` returns. No coordinate-mapping math is implemented here — that's explicitly out of scope.
- **Captured result is NOT persisted to `chrome.storage`.** Chose a plain in-module singleton (`extension/src/capture/store.ts`, `setLastCapture`/`getLastCapture`) plus local React state in `Popup.tsx` for rendering. Rationale: a data-URL PNG can be several MB, this feature's job ends the moment a later feature's UI reads it, and the clarification's simpler/narrower default applies. **Shape handed off:** `{ ok: true, dataUrl: string /* full "data:image/png;base64,..." */, devicePixelRatio: number, capturedAt: number }`, importable as `CapturedScreenshot` from `extension/src/capture/store.ts`. The next M19 feature (annotation UI) should call `getLastCapture()` from a component mounted later in the same popup document tree rather than re-triggering a second `activeTab` capture.
- **Restricted-page detection uses tab-URL visibility, not URL-prefix matching.** Verified empirically (see Notes below) that Chrome withholds `tab.url` from `chrome.tabs.query` entirely for chrome://, the Web Store, and other-extension pages — even once `activeTab` has fired — so a prefix check against the (never-populated) URL is dead code in practice. `visible-tab.ts`'s `explainCaptureError` instead branches on whether `chrome.tabs.query` returned *any* URL at all: no URL seen → restricted-page message naming the reason; URL seen but capture still failed → "click the extension icon again" message (the ordinary not-yet-granted case).
- **Error handling never fails silently.** Every failure path returns `{ ok: false, reason: <human-readable string including the raw Chrome error text> }`; the popup renders it in a dedicated `data-testid="capture-error"` element and never swallows it.

## Out-of-scope work needed
- Annotation overlay UI and the pixel-coordinate mapping math that consumes `devicePixelRatio` (explicitly deferred to a later M19 feature per the spec).
- Upload of the captured PNG to the attachments bucket / task-creation Route Handler (later M19 feature per tech-decisions.md).
- No change made to `extension/manifest.json` — `activeTab`/`storage` permissions were already sufficient (declared by F280); this feature added no new permission.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Rendered the Capture button unconditionally (once past `loading`) rather than gating it behind "connected" status, since neither the spec nor the clarification restricts capture to authenticated users and `activeTab` capture has no auth dependency — narrower/simpler read of the clarification's tie-breaker (don't add an artificial auth gate the assertions don't ask for).
AUTONOMOUS_DECISION: Chose an in-module singleton over `chrome.storage.session` for the capture handoff, per the clarification's "simpler/narrower" default and because the captured PNG is a large in-memory blob best not round-tripped through a storage API a later feature would just read back out again within the same popup mount.

## Notes for the next worker
- **Real harness finding, worth reading before writing more Playwright tests against `chrome.tabs.*` APIs in this repo:** Playwright cannot script a real user gesture on the extension's toolbar *action* (already noted in `popup.spec.ts`), so `activeTab` is never actually granted no matter what page is active or what element inside the directly-navigated popup document gets clicked. I additionally verified empirically that `host_permissions` (`http://localhost:3000/*`) does **not** substitute for `activeTab` specifically for `chrome.tabs.captureVisibleTab` — Chrome still rejects with `"Either the '<all_urls>' or 'activeTab' permission is required."` even when the active tab's origin matches a declared host permission. This means the *real* `chrome.tabs.captureVisibleTab` success path cannot be driven end-to-end through this test harness without either a real toolbar click (not scriptable) or `<all_urls>` (explicitly rejected by tech-decisions.md). AS_539's test therefore stubs only `chrome.tabs.captureVisibleTab`/`chrome.tabs.query` (via `page.addInitScript`, before the popup script runs) with a real PNG Playwright itself screenshotted from on-screen content, so everything downstream of the API call (decode, render, wiring) is exercised for real. AS_541 needed no such stub — it drives the real API against a real `chrome://extensions` tab, which fails in this harness for the same fundamental `activeTab` reason, and I use that real, deterministic failure (plus the real, verified fact that Chrome hides `tab.url` for that page) to prove the restricted-page message path.
- If a future worker gets an actual `<all_urls>`-free way to grant `activeTab` in Playwright (e.g. a newer Playwright release adds action-click scripting for MV3), it would be worth replacing AS_539's stub with a fully real capture — flagged here so it isn't forgotten, but not a blocker for this feature.
- MCP usage: none (pure client-side browser API feature, no external service state to introspect, matching the feature spec's "MCP at run: none").
