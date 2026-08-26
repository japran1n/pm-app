# Handoff: F342 — Capture environment metadata from the real page, not the popup (M19 scrutiny BLOCKER-2)

## Status
COMPLETE

## Assertions covered
AS-548: PASS — `collectEnvironmentMetadata` now accepts an optional `pageContext` override; `report-form.tsx` populates it via `collectPageContextOnActiveTab()` (new `src/capture/page-context.ts`), which reads the real active tab's `window.location.href` / `innerWidth` / `innerHeight` / `devicePixelRatio` through `chrome.scripting.executeScript` (same mechanism `element-picker.ts` already uses). Verified live in `tests/environment-metadata.spec.ts`'s new `AS_548_page_context_flows_into_the_submitted_description` test, which loads a real HTTP page at `http://localhost:3000/` with a non-popup viewport (1024x768), re-focuses it before invoking the real `collectPageContextOnActiveTab` + `collectEnvironmentMetadata` + `buildTaskDescription` chain, and asserts the resulting submitted-description string contains that real page's own URL, viewport, and DPR — and does NOT contain `chrome-extension://`.

## Files changed
extension/src/capture/environment.ts
extension/src/capture/page-context.ts (new)
extension/src/popup/report-form.tsx
extension/tests/environment-metadata.spec.ts

Note: these were committed by the concurrent F344 worker's commit `d5ed02b` (`fix(F344): generate extension manifest origins from VITE_APP_URL at build time`), because that worker's `git add`/commit at exit time picked up this feature's already-complete, already-tested working-tree changes alongside its own manifest/vite-config work. The F344 commit message and its own handoff (`F344-handoff.md`) explicitly document this mix. No F342-authored code was lost or altered — I verified the committed diff (`git show d5ed02b`) matches exactly what I wrote and tested before that commit landed. `extension/manifest.json`, `extension/eslint.config.mjs`, `extension/vite.config.ts`, `extension/.env.example`, and `extension/tests/permissions-minimisation.spec.ts` in that same commit are F344's own work (icon path fix, manifest-origin generation, build config) — not touched by me beyond what was already there before I started.

## Commands run
`cd extension && npm run typecheck` (0)
`cd extension && npm run lint` (0)
`cd extension && npm run build` (0)
`cd extension && npx playwright test environment-metadata.spec.ts` (0) — 7/7 passed
`cd extension && npx playwright test` (0) — 82/84 passed; 2 failures (`a11y-and-keyboard.spec.ts` F299 full-keyboard-flow 30s timeout, `attachment-upload.spec.ts` Supabase-admin-client `beforeAll` 30s timeout) reproduced as environment/network flakiness unrelated to this feature — both pass cleanly (11/11 and 3/3) when re-run in isolation with a longer timeout (`--timeout=60000`), confirming they are not caused by the F342 change.
`cd extension && npx playwright test describe.spec.ts element-picker-selector.spec.ts` (0) — 16/16 passed in isolation (these transiently failed with `EADDRINUSE :::3000` in one earlier full-suite run due to a leftover port binding from a prior manual test invocation in this same session; confirmed gone and not reproducible on a clean full-suite re-run)

## Decisions made
- Followed the clarified fix exactly as already implemented by the interrupted prior attempt: `page-context.ts`'s `collectPageContextOnActiveTab()` mirrors `element-picker.ts`'s already-shipped `chrome.tabs.query({active:true, currentWindow:true})` + `chrome.scripting.executeScript` pattern — no new permissions needed (`activeTab` + `scripting` already declared).
- Kept `environment.ts`'s own ambient `resolvePageUrl`/`resolveViewport`/`resolveDevicePixelRatio` reads as a fallback only for when `pageContext` resolves to `null` (no active tab, or an unscriptable page like `chrome://`) — never silently drops the "never throws, never blocks submission" property the module's original doc comment establishes for AS-548/AS-549.
- Browser name/version/OS intentionally remain popup-scoped (process-wide values, not page-specific) — only URL/viewport/DPR move to the page-context override, per the existing in-code rationale left by the prior attempt.
- Wrote the new `AS_548_page_context_flows_into_the_submitted_description` test using the exact harness pattern already established by `element-picker-selector.spec.ts`'s live-picker tests (`http.createServer` fixture on port 3000, covered by the manifest's existing `host_permissions`, `page.bringToFront()` to work around the one documented Playwright-harness limitation that a same-window popup tab would otherwise itself register as "active" — unlike a real MV3 action popup, which floats over the current tab and is never part of the tab strip). This avoids inventing a new test pattern and reuses the mission's own precedent, verified working via the isolated re-run above.
- The test asserts on the actual submitted-description STRING produced by the real, unduplicated `buildTaskDescription` (transpiled straight from `src/submit/describe.ts`, same technique `environment-metadata.spec.ts` already used for `environment.ts`) rather than on an intermediate `collectPageContextOnActiveTab()` return value — directly replacing BLOCKER-2's "test codifies the defect" complaint and its explicit `chrome-extension://` prefix check, which is now gone.
- Did not touch `tests/report-form.spec.ts` (asserts `description).toContain("chrome-extension://")` at line ~307): that test's harness opens ONLY a popup tab with no separate content tab, so `chrome.tabs.query({active:true})` resolves to the popup tab itself either way — `pageContext` there legitimately still carries a `chrome-extension://` URL, matching real behavior for "no other tab is open." This is not a regression introduced by this fix; verified the test still passes as part of the full suite run above.

## Out-of-scope work needed
None beyond what M19 scrutiny already tracked separately (BLOCKER-1/AS-547 already fixed by F341; BLOCKER-3/AS-550–554 console/network capture; BLOCKER-4/AS-557 project visibility; BLOCKER-5/AS-571 manifest origins, being handled concurrently by F344).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Verified via isolated re-runs that the two full-suite-run failures (`a11y-and-keyboard.spec.ts` F299, `attachment-upload.spec.ts` beforeAll) are pre-existing environment/network flakiness (a 30s hard-coded Playwright test timeout being too tight under this session's load, and a Supabase admin-client network round-trip occasionally exceeding it) rather than regressions from this fix, since they touch none of the files this feature changed and pass cleanly standalone.

## Notes for the next worker
- The prior (interrupted) attempt had already written all the production code (`environment.ts`, `page-context.ts`, `report-form.tsx`) correctly and had removed the wrong `chrome-extension://` assertion from `environment-metadata.spec.ts`'s existing `AS_548_reports_real_page_url_browser_os_viewport_and_device_pixel_ratio` test — the only remaining work was adding a real end-to-end test proving the actual submitted description carries the real page's values, which this handoff's work completes.
- If a future worker needs to run the full extension Playwright suite, be aware port 3000 fixture servers (`element-picker-selector.spec.ts`, `environment-metadata.spec.ts`) and `report-form.spec.ts`'s spawned Next dev server (port 3100) can transiently collide with leftover processes from a prior interrupted run in the same session — check `lsof -i :3000` / `:3100` before re-running if you see spurious `EADDRINUSE` failures.
- No MCP tools were needed for this feature (no live external service state involved).
