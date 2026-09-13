# F000b: Make vitest resolve `server-only` the way the RSC runtime does

**Milestone:** M0 — Make the gate trustworthy

**Est:** 30 min · **Depends on:** F000
**Covers:** AS-023
- F000 declared the dependency but the guarded test still cannot load. Cause:
  `server-only` exports `empty.js` under the `react-server` condition and an
  unconditionally-throwing `index.js` otherwise. Next sets that condition for
  Server Components; vitest sets nothing, so every importer throws
- Alias `server-only` to the package's own `empty.js` in `vitest.config.ts`'s
  existing `resolve.alias` block — the same no-op module the RSC runtime picks
- Prefer the alias over adding `react-server` to `resolve.conditions`: that
  condition also changes how `react` itself resolves, which would affect every
  client-component test that renders through testing-library. The alias
  touches one specifier
- Then `tests/unit/sign-out-back-navigation.test.ts` must load and pass, and
  must be removed from `tools/known-failing.txt`
- If it loads but fails on its actual assertion, that is a real finding: leave
  it in the baseline, say so in the handoff, and do not change the layout to
  satisfy it
**Files:** `vitest.config.ts`, `missions/20260913-perf-latency/tools/known-failing.txt`

## Why this exists

Read `missions/20260913-perf-latency/handoffs/F000-handoff.md`, including the orchestrator correction at
the bottom. The short version: there is **no** layering violation in this
codebase. `server-only` throws for any importer that does not resolve under
the `react-server` export condition, server or client. Next sets it, vitest
does not. `npm run build` passes, which proves the app is fine.

Do not "fix" any client component. Do not move any import. The change is one
alias in the vitest config.

## Notes for the worker

- Work **only** in `/Users/sasajapranin/Desktop/pm-app-perf` on branch
  `perf/latency`. `cd` there first and confirm with `pwd` and
  `git branch --show-current`. `/Users/sasajapranin/Desktop/pm-app` is the
  user's own checkout and they are using the app against it right now.
- Do **not** start a dev server, on any port.
- Verify with `missions/20260913-perf-latency/tools/test-gate.sh` — it must print `GATE PASSED`.
- Commit as `feat(F000b): <summary> [assertions: AS-023]` before exiting.
