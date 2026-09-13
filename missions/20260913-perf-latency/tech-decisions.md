# Tech decisions — Request latency under /w/*

_Mission: 20260913-perf-latency_

No new dependency is added by this mission. Every mechanism it uses already
ships with the versions in `package.json` at mission start, so there is
nothing here whose currency needs re-verifying against a registry: the
question "is this the current way" is answered by the installed version, not
by a release note.

## Installed versions this mission depends on

| Package | Version | What this mission uses from it |
|---|---|---|
| `next` | 16.3.1 | App Router streaming, `Suspense` in layouts, `proxy.ts` |
| `react` | 19.2.8 | `cache()` for request-scoped memoisation |
| `@supabase/ssr` | 0.12.4 | `createServerClient`, cookie adapter |
| `@supabase/supabase-js` | 2.112.3 | PostgREST builder, `.rpc()` |
| `vitest` | 4.1.10 | the suite the hook re-runs on every worker exit |

## Request-scoped memoisation: React `cache()`

`cache()` memoises per request, which is exactly the lifetime this mission
needs — a value must not leak between two users' requests, and must not
survive into the next one. `unstable_cache` and `"use cache"` are the wrong
tools here: they persist across requests, and every value this mission
deduplicates (the caller's identity, their membership, their workspace) is
per-user and must not be shared. This is also why no `revalidate` is set
anywhere in this mission.

`lib/actions/authz.ts` already wraps `getAuthenticatedUser` in `cache()`, so
the pattern is established in this codebase; the mission extends it rather
than introducing it.

## Why the auth call is a network call

`supabase.auth.getUser()` issues `GET /auth/v1/user` on every invocation —
auth-js does not memoise it, and each `createClient()` constructs a fresh
client with fresh state. Measured at 97–221 ms from this machine, mean 139 ms
over ten sequential calls. This is the single most-repeated cost in the app
and the reason M1 comes first.

`getClaims()` verifies the JWT locally and avoids the network, but it trusts
the token's signature rather than asking the server whether the session is
still valid. This mission does **not** swap `getUser` for `getClaims` on any
authorization path. The one place local verification is acceptable is the
proxy's cheap rejection of requests that carry no session cookie at all — no
token, no verification needed — which is F006.

## Database changes are additive only

The worktree shares one Supabase project with the app the user is testing
against. Any migration this mission applies is therefore visible to a running
application immediately. The rule (PF-027) is absolute: `CREATE` only. No
`DROP`, no `ALTER` of an existing object, no policy replacement. A new RPC
that nothing calls yet changes no behaviour for anyone; a dropped or altered
one can break a page mid-session for someone using the app.

## Isolation from the user's environment

This mission runs in the worktree `~/Desktop/pm-app-perf` on branch
`perf/latency`, with its own `node_modules` and its own `.env` copy. The
user's checkout at `~/Desktop/pm-app` and the dev server they are using on
port 3000 are not touched.

Workers **must not** start a dev server. Verification in this mission is by
unit test, by reading the code, and by counting calls against a mocked
Supabase client — not by loading pages. If a worker believes a change needs a
running app to verify, that is a signal the change is doing more than the
refactor it was scoped to, and the worker should say so in its handoff rather
than start a server. The orchestrator runs any browser verification at
milestone boundaries, on a port other than 3000.

## How to verify a deduplication assertion

Assertions PF-001 through PF-007 are about call counts, which are testable
without a network. The pattern: `vi.mock("@supabase/ssr")` with a
`createServerClient` stub whose `auth.getUser` and `from` are `vi.fn()`,
render or invoke the unit under test, then assert on `mock.calls.length`.
Several tests in `tests/unit/` already mock this module; follow the closest
existing one rather than inventing a new harness.

## How to run tests

```
npm run test
```

## How to run linter

```
npm run lint
```

## How to run a single test file

```
npx vitest run tests/unit/<file>
```
