# Handoff: F300 — build, package, and ship

## Status
COMPLETE

## Assertions covered
AS-571: PASS — added `extension/tests/build-and-packaging.spec.ts` (2 tests). Ran the real root `npm run build:extension` command twice in a row; both runs exit 0, print `check-no-secret-key: PASS`, produce a `extension/dist/manifest.json` whose `icons`/`action.default_icon` references all resolve to real files under `extension/dist/`, and produce a non-empty `extension/dist.zip` whose contents were actually listed (via `unzip -l`, not just an existence check) and contain `manifest.json` plus the icon files. Second run reproduces the same version and same artifact shape (no leftover state from run 1 breaks run 2). Also added a companion test proving `extension/package.json`'s version is the single source of truth that both the source and built `manifest.json` agree with.

## Files changed
package.json (added `build:extension` script)
extension/package.json (build script now runs `sync-version.mjs` first)
extension/manifest.json (added top-level `icons` and `action.default_icon`)
extension/scripts/sync-version.mjs (new)
extension/scripts/generate-icons.mjs (new)
extension/public/icons/icon16.png (new)
extension/public/icons/icon48.png (new)
extension/public/icons/icon128.png (new)
extension/store-listing.md (new)
extension/tests/build-and-packaging.spec.ts (new)
README.md (new "Browser extension (QA feedback capture)" section)

## Commands run
`cd extension && node scripts/generate-icons.mjs` (0) — generated the three real PNG icon files
`npm run build:extension` (repo root) (0) — twice in a row, both clean; `check-no-secret-key: PASS` printed both times
`cd extension && npx playwright test tests/build-and-packaging.spec.ts` (0) — 2/2 passed
`cd extension && npx tsc --noEmit` (0)
`cd extension && npx eslint .` (0) — 1 pre-existing unrelated warning in console-capture.spec.ts (unchanged from F298's note)
`npx tsc --noEmit` (repo root, app workspace) (0)
`npx eslint .` (repo root, app workspace) (0) — 1 pre-existing unrelated warning in lib/queries/search.ts (unchanged from F298's note)
`cd extension && npx playwright test` (0) — full suite, run 1: 93 passed (includes the new 2-test file plus F280–F299's existing 91)
`cd extension && npx playwright test` (0) — full suite, run 2 (flakiness check): 93 passed
`git status --short` — clean except this handoff + the changed/new files listed above; `next-env.d.ts` pre-existing modification (noted untouched in F298's handoff too) left out of this commit
Note: did not run the full app-level `npm test` (vitest) or full repo lint per this feature's process rules — only ran targeted checks above; the orchestrator runs the full suite afterward.

## Decisions made
- **Single source of truth for version:** chose `extension/package.json`'s `"version"` field as authoritative (not `manifest.json`) because npm tooling/CI conventionally reads `package.json`, and it's the file a human bumps with `npm version`. Verified the two were previously independently-maintained (`manifest.json`'s `version` was hand-typed and had no automatic tie to `package.json`). Closed the gap with a new `extension/scripts/sync-version.mjs`, wired as the first step of `extension`'s own `npm run build`, which overwrites `manifest.json`'s `version` field in place from `package.json` before every build (idempotent — no-op if already in sync). `manifest.json`'s field itself cannot be deleted since Chrome reads it directly from the manifest at install/load time.
- **Root `build:extension` script delegates, does not duplicate:** `"build:extension": "cd extension && npm run build"` — per the spec's explicit instruction, this is a thin wrapper around the existing `extension`'s own build chain (`sync-version.mjs` → `vite build` → `check-no-secret-key.mjs` → `zip.mjs`), not a parallel/reimplemented pipeline. Confirmed the secret-key guard (`AS-538` backer) still runs and passes as part of this command by checking real stdout for `check-no-secret-key: PASS` in the test, not by re-implementing a separate check.
- **Icon sizes (16/48/128):** verified current requirement via `developer.chrome.com/docs/extensions/reference/manifest/icons` (fetched 2026-08-21) rather than assuming from memory — confirmed 16x16/48x48/128x128 are the sizes Chrome documents for the manifest `icons` field, and 128x128 is also what the Chrome Web Store dashboard requests as the store listing icon (`developer.chrome.com/docs/webstore/images`, same fetch date).
- **Icon placement:** used Vite's default `public/` directory convention (`extension/public/icons/`) rather than a source-relative path handled specially by `@crxjs/vite-plugin` — Vite's default `publicDir` behaviour (files under `public/` copy verbatim into `outDir`, preserving subpaths) already satisfies "ship into `dist/` unchanged" with zero config changes to `vite.config.ts`. Verified after a real build that `extension/dist/public/icons/icon{16,48,128}.png` exist and that `dist/manifest.json`'s icon paths (`public/icons/icon16.png` etc.) genuinely resolve to those files.
- **`action.default_icon` added:** F280's manifest had `action.default_popup`/`default_title` but no `default_icon`, so Chrome showed a generic default toolbar icon (noted as a gap by this feature's spec). Added the same three-size icon set under `action.default_icon`, matching Chrome's documented toolbar-icon convention.
- **Icon artwork:** simple flat-colour placeholder (indigo rounded square with a white circular glyph), generated programmatically via `pngjs` (already a devDependency, no new dependency added) in `extension/scripts/generate-icons.mjs` — per the spec's own framing, this is a QA/internal tool, not a consumer product needing professional design; a clean, simple mark is sufficient.
- **`store-listing.md`:** reuses `extension/PERMISSIONS.md`'s justification text by reference/link rather than inline-copying it, documented explicitly in `store-listing.md` itself as a "one source of truth" choice mirroring the version-number decision above — if `PERMISSIONS.md` is extended for a future permission, `store-listing.md` doesn't need a parallel edit. Verified current Chrome Web Store listing field conventions (short/detailed description, category, icon, screenshots, privacy-practices data-disclosure tab, single-purpose statement) via `developer.chrome.com/docs/webstore/*` fetched 2026-08-21, rather than guessing the field list from memory.
- **Distribution recommendation:** per the clarification's "simpler, more private option" default, documented Unlisted (not Public) as the recommended first publish step in both `store-listing.md` and the new README section — matches this extension's actual audience (this project's own QA team).
- **Chrome Web Store fee:** re-verified `developer.chrome.com/docs/webstore/register` (fetched 2026-08-21) still describes a one-time registration fee with no contradicting figure surfaced in the page's plain text; kept `tech-decisions.md`'s documented US$5 figure but explicitly told the human publisher in the README to confirm the exact current figure on the dashboard itself before paying, since Google can change it without notice and the page's rendered fee amount wasn't extractable via a plain curl fetch (likely client-rendered).
- **Test approach for AS-571:** followed the existing `no-secret-key.spec.ts` (F281) convention of shelling out to real commands from inside a Playwright test file (run via `npx playwright test`, not vitest) rather than inventing a new test-runner convention — this repo already treats Playwright as the place for "run a real command and assert on real filesystem/stdout results" tests, not just browser-driven ones. Used the system `unzip -l` command to genuinely list zip contents (not add a new zip-reading npm dependency) since `unzip` is present on macOS/CI runners.

## Out-of-scope work needed
None identified beyond this feature's own scope. The store-listing.md screenshots section explicitly flags that real product screenshots (1280x800, showing the popup mid-flow) still need to be taken by a human before actual Chrome Web Store submission — this is called out as a placeholder in both `store-listing.md` and is inherent to "cannot take real product screenshots" from this feature's own spec, not a gap this feature should have closed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `extension/package.json` (not a hand-authored `manifest.json`) as the single source of truth for version, per the spec's own suggested option "have manifest.json be hand-authored as authoritative... pick one" — picked the npm-package.json-as-source option since it's the more conventional JS-tooling pattern and lets a future `npm version` bump propagate automatically via the new sync script, whereas the reverse (manifest-authoritative) would require inventing a non-standard read-manifest-into-package.json step with no established npm convention behind it.
AUTONOMOUS_DECISION: Icon placement under `extension/public/icons/` using Vite's default `publicDir` passthrough, rather than crx-plugin-managed source-relative paths, since it required zero changes to `vite.config.ts` and was verified with a real build to correctly land files in `dist/` with paths the built manifest correctly references.

## Notes for the next worker
- This is the final feature of M19 (F280–F300). The milestone's feature list is now fully implemented; next step is milestone-level scrutiny/UX validation.
- `extension/scripts/sync-version.mjs` and `extension/scripts/generate-icons.mjs` are one-off/build-time utility scripts — `generate-icons.mjs` does not need to run again unless the icon artwork itself changes (the PNG files are committed); `sync-version.mjs` runs automatically on every build.
- Verified Chrome docs URLs used (fetched 2026-08-21): `developer.chrome.com/docs/extensions/reference/manifest/icons`, `developer.chrome.com/docs/webstore/images`, `developer.chrome.com/docs/webstore/register`.
- No MCP tools used (feature spec: "MCP at run: none").
