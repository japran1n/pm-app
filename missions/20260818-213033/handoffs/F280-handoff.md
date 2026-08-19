# Handoff: F280 — Chrome MV3 extension skeleton

## Status
COMPLETE

## Assertions covered
AS-531: PASS — `extension/tests/popup.spec.ts` (`AS_531_extension_loads_as_mv3_and_opens_popup_on_toolbar_click`) loads the built unpacked extension in a Playwright persistent Chromium context, confirms the MV3 background service worker starts (proves it loaded as a valid MV3 extension), then opens the popup document at `chrome-extension://<id>/src/popup/index.html` and asserts the "Not connected" shell renders. Ran via `npx playwright test` in `extension/` — 1 passed.

## Files changed
extension/package.json
extension/package-lock.json
extension/manifest.json
extension/vite.config.ts
extension/tsconfig.json
extension/eslint.config.mjs
extension/playwright.config.ts
extension/scripts/zip.mjs
extension/src/popup/index.html
extension/src/popup/main.tsx
extension/src/popup/Popup.tsx
extension/src/background/service-worker.ts
extension/tests/popup.spec.ts
.gitignore
eslint.config.mjs (root — ignore extension/**)
tsconfig.json (root — exclude extension)

## Commands run
`cd extension && npm install` (0)
`cd extension && npm run build` (0) — produces `extension/dist/` (unpacked, loadable) and `extension/dist.zip`
`cd extension && npx playwright test` (0) — 1 passed (AS-531)
`cd extension && npx tsc --noEmit` (0)
`cd extension && npx eslint .` (0)
`npx tsc --noEmit` (root app) (0)
`npx eslint .` (root app) (0) — 1 pre-existing unrelated warning in `lib/queries/search.ts` (unused var), not touched by this feature
`npm run build` (root Next.js app) (0) — full production build succeeds unchanged

## Decisions made
- **MV3 Vite plugin: `@crxjs/vite-plugin@2.7.1`.** Verified via `npm view @crxjs/vite-plugin versions --json` and `npm view @crxjs/vite-plugin dist-tags` (2026-08-19): dist-tag `latest` is `2.7.1`, published stable (not the `2.0.0-beta.*` line). Verified peer compatibility via `npm view @crxjs/vite-plugin@2.7.1 peerDependencies` — declares `"vite": "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0"`, compatible with the `vite@^8.2.1` installed (`npm view vite version` → `8.2.1`). Source: npm registry package metadata for `@crxjs/vite-plugin`, checked 2026-08-19.
- **Own `tsconfig.json` and `eslint.config.mjs` for `extension/`, not shared with the root app** (per clarification's "take the simpler, narrower option" guidance). Reasoning: the extension runs in a service-worker/`chrome.*` global environment that has no `window`/DOM lifecycle parity with Next's browser runtime, uses a different module target (`ESNext`/bundler resolution for a Vite/CRXJS build vs. Next's own bundler pipeline), and needs `@types/chrome` + `chrome`/`webextensions` ESLint globals that would be actively wrong (and noisy) if applied to `app/`, `components/`, `lib/`. Root `tsconfig.json` gets `extension` added to `exclude`; root `eslint.config.mjs` gets `extension/**` added to `globalIgnores`. This is the narrower, lower-blast-radius option: the extension workspace is fully self-contained (own `package.json`, own `node_modules`, own lockfile) and cannot accidentally break the app's typecheck/lint/build, which the checks above confirm.
- **Separate npm workspace under `extension/` with its own `node_modules`**, not a monorepo `workspaces` entry in the root `package.json`. Kept the root `package.json` untouched (no `workspaces` field added) since the spec only requires the extension not break the existing app's build/lint/typecheck — adding workspace config would touch more of the root than necessary for a skeleton feature.
- **No icons in `manifest.json`.** `action.default_popup` + `background.service_worker` + `permissions: ["activeTab"]` is a valid, loadable MV3 manifest without icon assets; icon PNGs are cosmetic and out of scope for a skeleton — added them here would just be placeholder noise. Chrome falls back to a default puzzle-piece icon in `chrome://extensions` until real icons are supplied.
- **Playwright test opens the popup document directly at its `chrome-extension://<id>/src/popup/index.html` URL** rather than trying to script a real toolbar-icon click. Playwright has no API to click the actual browser toolbar (it's outside the page/DOM it controls); the documented pattern (https://playwright.dev/docs/chrome-extensions) is to load the unpacked extension via `launchPersistentContext` with `--disable-extensions-except` / `--load-extension`, confirm the background service worker started (proof the MV3 extension loaded correctly, which is the "loads as MV3" half of AS-531), then navigate directly to the popup's own HTML document — which is exactly the document Chrome renders when the user clicks the toolbar icon (the "opens its popup" half of AS-531).
- **Test runs headed (`headless: false`), not headless.** Confirmed empirically in this environment: `headless: true` timed out waiting for the `serviceworker` event (classic headless Chromium silently ignores `--load-extension`); switching to `headless: false` on this macOS worker passed in ~5s. Documented in the test file with the reasoning and the Playwright docs link.
- **`archiver@8.0.0`'s zip script uses the new class-based ESM API** (`import { ZipArchive } from "archiver"`), not the older `archiver(format, opts)` factory function referenced by most existing tutorials. Discovered by inspecting `node_modules/archiver/index.js` after the factory-function call threw `archiver is not a function` — archiver 8 is pure ESM and exports `Archiver`/`ZipArchive`/`TarArchive`/`JsonArchive` classes. `directory()`, `pipe()`, `finalize()`, `pointer()` still work the same on `ZipArchive` instances.
- **No secrets in the build.** This skeleton has no auth/env wiring at all (popup renders a static "Not connected" shell, background worker just logs on install), so there is nothing that could leak into `dist/`. Flagging for later auth features: per tech-decisions.md, only the `sb_publishable_*` key is ever meant to ship in the bundle — no service key.

## Out-of-scope work needed
- Capture (screenshot via `chrome.tabs.captureVisibleTab`), console-log ring buffer content script, session handoff from the web app, `chrome.storage.local` auth adapter, and the authenticated Route Handler for task creation are all explicitly deferred to later M19 features per the spec and tech-decisions.md.
- Real extension icons (16/48/128px) were not added — cosmetic, not required for AS-531 or the DoD.
- No Chrome Web Store submission was attempted (requires the user's one-time $5 developer registration, out of scope per tech-decisions.md "New external dependency").
- Root `package.json` was not modified to add a top-level script (e.g. `npm run build:extension`) that runs both workspaces — the orchestrator/CI can `cd extension && npm run build` directly; flag if a future feature wants a unified root script.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `@crxjs/vite-plugin@2.7.1` (current npm `latest` dist-tag) over the `2.0.0-beta.*` prerelease line, since the clarification's version-freshness rule calls for verifying via search/npm rather than memory, and a stable tagged release is the safer default for a build-tooling dependency with no indication a beta was required.
AUTONOMOUS_DECISION: Ran the extension's Playwright test headed rather than headless, based on empirical failure in this sandbox (headless silently drops `--load-extension`). If CI later runs headless-only, this test needs either a virtual display (e.g. `xvfb-run`) or Chromium's `--headless=new` flag verified to support extension service workers in the exact Chromium build Playwright ships — flagging for whichever feature wires up CI for the extension workspace.

## Notes for the next worker
- Build: `cd extension && npm install && npm run build` — produces `extension/dist/` (unpacked, load via `chrome://extensions` → Load unpacked) and `extension/dist.zip` (Web Store submission artifact). Both are gitignored (`.gitignore` has a new `--- EXTENSION (F280) build artifacts ---` block).
- Test: `cd extension && npm run build && npx playwright test` — the Playwright test requires `dist/` to exist first (it throws a clear error in `beforeAll` if not) since it loads the *built* extension, not source.
- Typecheck/lint: `cd extension && npx tsc --noEmit && npx eslint .`
- The extension's `node_modules` and `package-lock.json` are separate from the root app's — no root `package.json` changes, no workspaces config, by design (see Decisions Made).
- MCP: none used — this feature has no external service or live-state dependency (per the feature spec's "MCP at run: none").
