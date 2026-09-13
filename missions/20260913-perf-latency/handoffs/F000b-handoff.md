# Handoff: F000b — Make vitest resolve `server-only` the way the RSC runtime does

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `tests/unit/sign-out-back-navigation.test.ts` loads (no longer throws on `import "server-only"` deep in the layout's import graph) **and** its actual assertion passes: `npx vitest run tests/unit/sign-out-back-navigation.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`. It is not merely loading-and-failing; the single test in the file (`layoutModule.dynamic === "force-dynamic"`) is genuinely true. Removed from `tools/known-failing.txt` on that basis. `missions/20260913-perf-latency/tools/test-gate.sh` reports `GATE PASSED — no new unit test failures. Known-failing baseline unchanged.`

## Files changed
vitest.config.ts
missions/20260913-perf-latency/tools/known-failing.txt

## Commands run
`node -e "console.log(require.resolve('server-only/empty.js'))"` (1, expected failure) — confirmed Node's own `exports` resolution refuses subpaths not declared in `server-only`'s conditional exports map, which is why the alias target has to be the literal `node_modules/server-only/empty.js` path rather than a specifier vitest could resolve unaided
`npx vitest run tests/unit/sign-out-back-navigation.test.ts` (0) — 1 file, 1 test, both passed
`npx vitest run tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/f038-as024-coverage.test.ts tests/unit/xss-sanitization-audit.test.ts` (1) — all three still fail, same failing assertions as before this change (unrelated to `server-only`)
`npx vitest run tests/unit` (1, expected — pre-existing baseline failures) — full unit run: `3 failed | 391 passed (394)` test files, `4 failed | 2592 passed (2596)` tests. The 4 failing tests are exactly the ones inside the 3 files already listed in `tools/known-failing.txt` (AS-509/AS-513 in `app-sidebar-project-nav-list.test.tsx`, AS-024 in `f038-as024-coverage.test.ts`, AS-148 in `xss-sanitization-audit.test.ts`). No file that was passing before this change now fails, and no file besides `sign-out-back-navigation.test.ts` newly passes. (The run also prints two "Unhandled Rejection" / "Serialized Error" blocks from `board-taskid-deeplink.test.tsx` and `f246-task-detail-sheet-copy-link.test.tsx` — both are `cookies() was called outside a request scope` noise from Next's cookie API being invoked in a non-request test context; they do not appear in the `FAIL` list, are unrelated to the `server-only` alias, and are unchanged by this diff.)
`missions/20260913-perf-latency/tools/test-gate.sh` (0) — `GATE PASSED — no new unit test failures. Known-failing baseline unchanged.`
`npm run lint` (0) — 0 errors, 37 warnings (matches accepted baseline)
`git status --short` — clean tree after the feature commit `c11668ea`

## Decisions made
- Added one entry to `vitest.config.ts`'s existing `resolve.alias` block: the bare specifier `server-only` → the absolute filesystem path of `node_modules/server-only/empty.js`. That is the exact same no-op file Next resolves to for a Server Component via the `react-server` export condition; the alias just gets vitest there by a different route, since vitest never sets that condition and Node's own conditional-exports resolution won't expose `empty.js` as a reachable subpath any other way.
- Chose the alias over `resolve.conditions: ["react-server"]` because that config option is global to the whole resolution graph, not scoped to one package: it would also flip which condition `react` itself resolves under, which changes what module client components actually get in every test that renders through `@testing-library/react`. That is a much larger blast radius than fixing the one specifier that is actually broken. The alias is exactly as wide as the bug: it only intercepts the string `server-only`, so every other import continues to resolve exactly as it did before this change (confirmed by the full-suite run above showing zero deltas outside the target file).

## Out-of-scope work needed
None. This closes out the investigation the F000 handoff's orchestrator correction opened: there is no client/server layering violation in this codebase to fix. The two chat components that mention `lib/queries/chat.ts` (`components/chat/channel-view.tsx`, `components/chat/chat-message-search.tsx`) import from it only via `import type`, which TypeScript erases before any runtime `import "server-only"` ever executes, so they never reach the throwing branch. `npm run build` already proved this at commit `c4667cc6` and nothing in this change touches application code.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — the alias-over-conditions choice was explicitly directed by the feature spec, not something I inferred)

## Notes for the next worker
- `tests/unit/sign-out-back-navigation.test.ts` is intentionally narrow and says so in its own header comment: it does **not** simulate real browser bfcache restoration (that needs a live browser and is covered at the Playwright/E2E level under AS-150). All it asserts is that `app/(workspace)/w/[workspaceSlug]/layout.tsx` exports `dynamic = "force-dynamic"` — i.e. it is a single string-literal check on the layout module's static exports, not a rendering/behavioral test. **If the upcoming workspace-layout rewrite removes or changes that `export const dynamic = "force-dynamic"` line, this test will fail even though nothing about auth or bfcache behavior may have changed** — check for that specific export before assuming a real regression, and if the rewrite intentionally moves to a different mechanism for defeating bfcache, that decision needs its own justification, not a silent test edit.
- The three remaining `tools/known-failing.txt` entries are unrelated to `server-only`/AS-023 and were not touched: `app-sidebar-project-nav-list.test.tsx` (AS-509/AS-513, a real assertion mismatch), `f038-as024-coverage.test.ts` (AS-024, a `waitFor` timeout on "Toggle theme" text), and `xss-sanitization-audit.test.ts` (AS-148, a genuine `dangerouslySetInnerHTML` sink in `app/layout.tsx`).
- If `server-only`'s package layout ever changes (e.g. `empty.js` gets renamed or moved) in a future dependency bump, this alias's literal path in `vitest.config.ts` must be updated in lockstep — there is deliberately no indirection through the package's own `exports` map, because that map is precisely what vitest cannot apply the right condition to.
