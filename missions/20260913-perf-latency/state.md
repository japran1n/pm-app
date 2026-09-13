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
| 6. Run | in progress |
| 7. Status | — |

## Run log

| Milestone | Features | Status |
|---|---|---|
| M1 Request-level deduplication | F001–F008 | pending |
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
