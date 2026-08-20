# Handoff: F298 — extension permissions minimisation

## Status
COMPLETE

## Assertions covered
AS-568: PASS — added `extension/tests/permissions-minimisation.spec.ts` (4 tests). Verified the built `dist/manifest.json` declares exactly `activeTab`, `storage`, `scripting`; exactly one `host_permissions` entry (`http://localhost:3000/*`); exactly one `content_scripts` entry scoped to `http://localhost:3000/extension-connect*`; `<all_urls>` and `*://*/*` never appear anywhere; source and built manifest agree; and `extension/PERMISSIONS.md` exists with a justification covering every declared permission/host-permission/content-script plus a plain-language "can/cannot see" disclosure.
AS-569: PASS — added `extension/tests/never-used-page-no-setup.spec.ts`. One holistic test serves a genuinely fresh page (random never-before-served path on a fresh HTTP server) and, on that single page in one test, exercises screenshot capture, element picking, and starting console capture back-to-back — all succeed the first time with no prior visit or setup beyond the popup interaction itself.

## Files changed
extension/PERMISSIONS.md (new)
extension/tests/permissions-minimisation.spec.ts (new)
extension/tests/never-used-page-no-setup.spec.ts (new)

## Commands run
`cd extension && npm run build` (0) — rebuilt; `check-no-secret-key: PASS` printed for the real build
`cd extension && npx playwright test tests/permissions-minimisation.spec.ts tests/never-used-page-no-setup.spec.ts` (0) — 5/5 passed after two fixes (see Decisions made)
`cd extension && npx tsc --noEmit` (0)
`cd extension && npx eslint .` (0) — 1 pre-existing unrelated warning in console-capture.spec.ts (unused eslint-disable directive), not touched by this feature
`npx tsc --noEmit` (repo root, app workspace) (0)
`npx eslint .` (repo root, app workspace) (0) — 1 pre-existing unrelated warning in lib/queries/search.ts
`cd extension && npx playwright test` (0) — full suite, run 1: 85 passed (includes the two new spec files' 5 tests plus F280–F297's existing 80)
`cd extension && npx playwright test` (0) — full suite, run 2 (flakiness check): 85 passed
`git status --short` — clean except this handoff + the three new files (next-env.d.ts modification pre-existed this session, untouched)

## Decisions made
- Manifest audit result: the current manifest (`activeTab`, `storage`, `scripting`; `host_permissions: ["http://localhost:3000/*"]`; one `content_scripts` entry scoped to `http://localhost:3000/extension-connect*`) is already the minimal set — every permission maps to a real, currently-used feature (F283 captureVisibleTab, F281/F296 chrome.storage.local, F287/F289/F290 chrome.scripting.executeScript). `<all_urls>` does not appear anywhere. **No manifest change was made** — confirmed by grep/read against manifest.json, service-worker.ts, popup source, and every capture/*.ts module before concluding nothing broader than what's declared is actually referenced.
- Per the clarification's explicit instruction, documented F281's one `content_scripts` entry as a *deliberate exception* to the "on-demand `chrome.scripting.executeScript`" pattern used everywhere else, not glossed over as the same category — explained in PERMISSIONS.md that it must run automatically (rather than on-demand) because it fires on the one-time sign-in handoff page before any toolbar-icon gesture has happened, so activeTab's gesture-only model can't cover it.
- AS-569 test fix #1: `page.addInitScript` callbacks only receive what's explicitly passed as the second argument — closure variables (e.g. `uniquePath`) are not available inside the injected function. Fixed by passing all needed values as a single serialized object argument.
- AS-569 test fix #2: initially also stubbed `chrome.tabs.query` (following the capture-visible-tab.spec.ts precedent for AS-539), but this broke element-picker targeting because the stub's returned tab object lacked a `url`/`id` shape the picker's own tab-lookup logic needs beyond what the stub provided. Removed that stub — `chrome.tabs.query` runs as the real Chrome API in this test (works because the fixture origin is covered by `host_permissions`, same trick F287/F289 already rely on), and only `chrome.tabs.captureVisibleTab` (the one call that strictly requires the real toolbar-icon gesture Playwright cannot script) is stubbed, using a real Playwright-captured screenshot of the actual fresh page as the stub's return value.
- Left the pre-existing unrelated lint warnings (console-capture.spec.ts, lib/queries/search.ts) untouched — out of this feature's scope per the spec's "Touches" boundary.

## Out-of-scope work needed
None identified. This was an audit feature and the manifest was already minimal — no follow-up work surfaced.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted the spec's "if you find anything that isn't minimal... narrow it" bullet as conditional and inapplicable here, since the audit found the manifest already minimal (matching F280/F281/F287's established discipline) — documented that conclusion in PERMISSIONS.md and this handoff rather than inventing a manifest change to justify the feature's existence.

## Notes for the next worker
- `extension/PERMISSIONS.md` is written to be store-listing-reusable as-is (short paragraph per permission, plus a plain-language "can/cannot see" section for a non-technical privacy-disclosure audience) — if a future feature adds a new permission, extend this file rather than replacing it, and `permissions-minimisation.spec.ts`'s `AS_568_every_declared_permission_has_a_written_justification` test will automatically fail if the new permission has no corresponding text in the doc (it checks the doc contains each manifest permission name).
- `never-used-page-no-setup.spec.ts` reuses the port-3000 fixture-server pattern from F287/F289 but serves a random, never-before-requested path per run (404s everything else) so the "never-before-used page" claim is genuinely provable, not just plausible.
- No MCP tools used (feature spec: "MCP at run: none").
