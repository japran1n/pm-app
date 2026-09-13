# Handoff: F000b — Make vitest resolve `server-only` the way the RSC runtime does

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `tests/unit/sign-out-back-navigation.test.ts` now loads and passes (`npx vitest run tests/unit/sign-out-back-navigation.test.ts` → 1 passed). Removed from `tools/known-failing.txt`. Gate reports `GATE PASSED`.

## Files changed
vitest.config.ts
missions/20260913-perf-latency/tools/known-failing.txt

## Commands run
`node -e "console.log(require.resolve('server-only/empty.js'))"` (1, expected) — confirmed `require.resolve` cannot see subpaths outside the package's `exports` map, which is exactly why an alias (not a bare import) is needed
`npx vitest run tests/unit/sign-out-back-navigation.test.ts` (0) — 1 passed
`npx vitest run tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/f038-as024-coverage.test.ts tests/unit/xss-sanitization-audit.test.ts` (1) — all three still fail, unchanged from mission-start baseline
`missions/20260913-perf-latency/tools/test-gate.sh` (0) — `GATE PASSED — no new unit test failures. Known-failing baseline unchanged.`
`npm run lint` (0) — 0 errors, 37 warnings (matches accepted baseline)
`git status --short` — clean tree after commit

## Decisions made
- Aliased the bare specifier `server-only` directly to the absolute filesystem path of `node_modules/server-only/empty.js` (via `fileURLToPath(new URL(...))`, consistent with the existing `@` alias's style) inside `vitest.config.ts`'s existing `resolve.alias` block, per the spec's explicit instruction. This is the same no-op module Next resolves to for Server Components via the `react-server` export condition — the alias just reaches it a different way, since `require.resolve`/`exports` won't expose that subpath directly to a raw import.
- Did **not** use `resolve.conditions: ['react-server']`, per the spec's explicit warning that it would also change how `react` resolves and could affect client-component tests rendered through testing-library. The one-specifier alias is scoped exactly to `server-only`.
- Removed `tests/unit/sign-out-back-navigation.test.ts` from `tools/known-failing.txt` because it now both loads and passes its actual assertion — not just loads. No other file in the baseline newly passed with this change, so no other line was removed.

## Out-of-scope work needed
None. Confirming the orchestrator's correction on F000's handoff: there is no client/server layering violation to fix. The two chat components that mention `lib/queries/chat.ts` (`channel-view.tsx`, `chat-message-search.tsx`) import it with `import type`, which is erased at compile time and never reaches this alias or the runtime throw path.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — followed the spec's alias instruction directly)

## Notes for the next worker
- The three remaining `tools/known-failing.txt` entries (`app-sidebar-project-nav-list.test.tsx`, `f038-as024-coverage.test.ts`, `xss-sanitization-audit.test.ts`) are unrelated to `server-only`/AS-023: a `waitFor` timeout looking for "Toggle theme" text, an assertion-output mismatch, and a real `dangerouslySetInnerHTML` sink in `app/layout.tsx` for AS-148, respectively. None were touched by this feature; they remain correctly listed.
- If a future dependency bump changes `server-only`'s package layout (e.g. renames `empty.js`), this alias's target path must be updated in lockstep — there is no indirection through the package's own `exports` map, by design, since that map is exactly what vitest can't apply the right condition to.
