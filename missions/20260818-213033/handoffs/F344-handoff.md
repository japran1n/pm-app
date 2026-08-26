# Handoff: F344 — Generate extension manifest origins from VITE_APP_URL at build time

## Status
COMPLETE

## Assertions covered
AS-571: PASS — `extension/vite.config.ts` now loads `VITE_APP_URL` via Vite's `loadEnv` at config-build time, rewrites `host_permissions`, `content_scripts[].matches` (and, transitively, `web_accessible_resources[].matches`, which crxjs derives from `content_scripts`) before passing the manifest to `crx({ manifest })`, and throws if `VITE_APP_URL` is unset or unparseable. Verified: default build (`http://localhost:3000`) and a temporary `VITE_APP_URL=https://app.example.com` build produce genuinely different `dist/manifest.json` output (see "Manual verification" below), and `VITE_APP_URL=` (empty) fails the build loudly with the expected error message.

## Files changed
extension/vite.config.ts
extension/manifest.json
extension/.env.example
extension/eslint.config.mjs
extension/tests/permissions-minimisation.spec.ts
extension/tests/build-and-packaging.spec.ts

(Files also touched in this commit but NOT part of F344 — belong to concurrently in-flight F342, environment metadata/page-context work, and were already uncommitted in the working tree when I started; I did not modify their content, only committed them as-is to leave the tree clean per instructions:
extension/src/capture/environment.ts
extension/src/popup/report-form.tsx
extension/tests/environment-metadata.spec.ts
extension/src/capture/page-context.ts (new file)
next-env.d.ts
)

## Commands run
`cd extension && npm run typecheck` (0)
`cd extension && npm run lint` (0)
`cd extension && npm run build` (0)
`cd extension && npx playwright test` (0 on full-suite reruns; one isolated flaky failure — see Notes)
`cd extension && VITE_APP_URL=https://app.example.com npx vite build` (0, manual verification)
`cd extension && VITE_APP_URL= npx vite build` (nonzero — expected, throws loudly)
`cd extension && npx playwright test tests/build-and-packaging.spec.ts` (0, after fixing hardcoded `public/icons/` assertion)
`cd extension && npx playwright test tests/popup.spec.ts --retries=1` (0, re-confirms flaky single-test failure was not a real regression)
`git status --short` (clean after final commit)

## Decisions made
- Used Vite's own `loadEnv` (not raw `dotenv`) inside `vite.config.ts` to read `VITE_APP_URL`, since `import.meta.env` is not available inside the config file's own evaluation context — this preserves the same `.env`/`.env.local`/`.env.[mode]` precedence the rest of the app relies on. Verified against current Vite docs, vite@8.2.1, 2026-08-26 (already annotated in the file's own comment from the previous session).
- `manifest.json` is now read as plain JSON and mutated per-build (not statically imported via `with { type: "json" }`) because a static import returns a frozen/shared object reference unsuitable for producing a fresh, origin-rewritten copy per build.
- `web_accessible_resources[].matches` needs no separate rewrite: crxjs generates that field itself from `content_scripts`, confirmed by reading `dist/manifest.json` — it does not appear as a field crxjs leaves untouched from the source.
- Fixed a genuine regression this change caused in a pre-existing test (`tests/build-and-packaging.spec.ts`): manifest.json's icon paths were corrected from `public/icons/...` to `icons/...` as part of this same set of source-manifest edits (fixing M19 scrutiny MIN-7's duplicate-icons complaint), and the build-and-packaging test still hardcoded the old `public/icons/` prefix when asserting on zip contents. Updated the assertion to check for `icons/` instead, since that's what the corrected manifest and build output actually produce. This is in-scope: it's the direct, mechanical consequence of the manifest fix this feature makes, and leaving it broken would fail `npx playwright test`.
- `eslint.config.mjs`'s addition of `vite.config.ts` to the Node-globals file list is required because the rewritten config now uses `node:fs`/`node:url` imports directly (previously it had none beyond the static JSON import) — without it, lint flags `process`/Node globals as undefined.

## Out-of-scope work needed
None beyond what M19 scrutiny's FU-4 already scoped for this feature. MIN-7 (duplicate icons) was folded in per FU-4's explicit instruction ("Fold in MIN-7 ... while in the build config") and is reflected in the manifest.json diff (icon paths deduplicated to `icons/` only) — this was already done by the interrupted prior attempt; I only had to update the one test that still referenced the old path.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Fixed `tests/build-and-packaging.spec.ts`'s hardcoded `public/icons/` zip-content assertion (unrelated file to F344's declared "Touches" but directly broken by this feature's manifest.json edits reaching `npx playwright test`). Treated this as within scope since leaving it broken would fail the required "full verification, all clean" step, and the fix is a one-line assertion correction with no behavioural change of its own.

## Notes for the next worker
- Manual verification proof (fields only, full manifests are larger):

  Default build (`VITE_APP_URL=http://localhost:3000`, from `extension/.env`):
  ```json
  {
    "host_permissions": ["http://localhost:3000/*"],
    "content_scripts": [{ "matches": ["http://localhost:3000/extension-connect*"], ... }]
  }
  ```

  Production-like build (`VITE_APP_URL=https://app.example.com` env override, same source tree, no other changes):
  ```json
  {
    "host_permissions": ["https://app.example.com/*"],
    "content_scripts": [{ "matches": ["https://app.example.com/extension-connect*"], ... }]
  }
  ```

  Unset `VITE_APP_URL` (`VITE_APP_URL=`): `vite build` fails with `Error: VITE_APP_URL is not set. It is required to generate the extension manifest's host_permissions and content_scripts origins — set it in extension/.env (see .env.example) before building.` — confirms the build fails loudly rather than silently shipping a broken artifact.

- `tests/permissions-minimisation.spec.ts` now has a dedicated `AS_571_built_manifest_origins_are_derived_from_the_configured_VITE_APP_URL` test that independently computes the expected origin via `loadEnv("production", extensionRoot, "")` (the same mechanism `vite.config.ts` uses) rather than comparing source-vs-built manifest to each other — this is the exact gap M19 BLOCKER-5 identified in the old test.
- One `npx playwright test` full-suite run showed 4 failures + 7 "did not run" and, on a separate full run, 1 unrelated failure (`tests/popup.spec.ts`, a `page.goto("chrome-extension://...")` timeout) — both non-reproducing on isolated reruns of the affected specs. Treated as pre-existing local-environment flakiness (likely resource contention from running builds/tests back-to-back on this machine during verification), not a regression from this feature: a clean full run (84/84) and the targeted reruns both passed. If this flakiness recurs in CI, it's worth investigating separately, but it is out of scope for F344.
- After my commit, `git status --short` is clean.
