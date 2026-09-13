# Mission state

_Mission: 20260913-perf-latency — Request latency under /w/*_

Runs in the worktree `~/Desktop/pm-app-perf` on branch `perf/latency`, isolated
from the user's checkout at `~/Desktop/pm-app` and the dev server they are
using on port 3000. Workers never start a server.

| Phase | Status |
|---|---|
| 1. Scope | done — from the measured audit of 2026-09-13 |
| 2. Discover | skipped — the audit is the discovery; 81 findings across 6 lenses |
| 3. Plan | done — 22 features, 28 assertions, `APPROVED` |
| 4. Connect | done — no new service; Supabase MCP already registered |
| 5. Tasks | done — 22/22 `[CLARIFIED-AUTO]` |
| 6. Run | in progress — M0 done, M1 started |
| 7. Status | — |

## Run log

| Milestone | Features | Status |
|---|---|---|
| M0 Make the gate trustworthy | F000, F000b | **done** — gate green, guarded test revived |
| M1 Request-level deduplication | F001–F008 | in progress |
| M2 Query narrowing | F009–F011 | pending |
| M3 Badge counters | F012–F015 | pending |
| M4 Streaming shell | F016–F020 | pending |
| M5 List route | F021–F022 | pending |

## Baseline, measured 2026-09-13 before any change

| Route | Warm TTFB, best of 3 | Soft navigation |
|---|---|---|
| `/w/<slug>` | 2.01 s | 1.57 s |
| `/w/<slug>/projects/<id>/list` | 1.61 s | 3.15 s |
| `/w/<slug>/projects/<id>/board` | 2.26 s | — |
| `/w/<slug>/my-tasks` | 2.04 s | 0.77 s |
| `/w/<slug>/calendar` | 2.62 s | — |
| `/w/<slug>/archive` | 1.42 s | 0.65 s |
| `/sign-in` (no session) | 0.03 s | — |

One Supabase round trip from this machine: 97–221 ms, median ~110 ms.
`auth.getUser()`: mean 139 ms over ten sequential calls.
Six queries in one `Promise.all`: 189 ms total.

## Notes

- The worktree shares one Supabase project with the app the user is testing.
  Every migration in this mission is additive (AS-027) for that reason.
- The audit's remaining findings that this mission does **not** address are
  listed under "Out of scope" in `description.md`, with the reason for each.

## M0 outcome, 2026-09-13

`tests/unit/sign-out-back-navigation.test.ts` was dead before this milestone —
it threw on import and could never reach its assertion. It now loads and
passes in 1.7 s. That matters more than the line count suggests: it is the
test that guards `export const dynamic = "force-dynamic"` on the workspace
layout, which is the file M1 and M4 rewrite most. The mission can now tell its
own breakage from the repo's.

Known-failing baseline is down from four files to three.

Two process notes worth carrying forward:

- **The F000 handoff's "layering violation" finding was wrong** and is
  corrected in place at the bottom of that file. `server-only` throws for any
  importer that does not resolve under the `react-server` export condition,
  server or client; the error text names Client Components because that is the
  case it was written for. `npm run build` passes, which a genuine
  client-component import of a server-only module would not. No follow-up
  feature should be opened for it.
- **The pre-worker-exit hook cannot tell which worker wrote which handoff.**
  It validates the most recently modified `F*.md`, so F000b exited clean
  having written none — F000's file satisfied the check on its behalf. The
  handoff was recovered by resuming that worker. Until the hook keys on the
  feature id, the orchestrator must confirm the expected handoff file exists
  by name after every worker.
