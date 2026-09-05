# F124: Every server action pays four sequential network round trips
before it starts

**Milestone:** post-portal — **performance**
**Estimated worker time:** 3–4 h
**Assertions:** AS-081 … AS-085
**Opened by:** the user, "aplikacija je spora", after a measured
investigation

## The measurement is already done. Start from it.

Taken from the dev server's own per-request breakdown
(`total (next.js: compile, proxy.ts: middleware, application-code: ours)`):

| what | measured |
|---|---|
| `getProjectTaskTypeOptions` — reads a handful of rows from a tiny table | **1259 ms** |
| `getProjectPhaseOptions` — same shape | **1153 ms** |
| `moveAndReorderTask` — dragging one task | **3122 ms** |
| `getNotificationSnapshot` — fires repeatedly per page | 205–924 ms |
| `proxy.ts` (middleware, every request) | 82–1934 ms |

Compilation (`next.js:`) is 3–20 ms warm and disappears in production —
it is NOT the problem, despite being the visible "Compiling" message.

**Root cause,** `lib/actions/authz.ts` lines ~127–190. Every action
wrapped in `withAuthz` runs these strictly one after another:

1. `createClient()` then `await supabase.auth.getUser()` — network call
   to Supabase Auth
2. `await options.resolveWorkspace(parsed.data, admin)` — DB query
3. `await requireActiveMembership(admin, workspaceId, user.id)` — DB query
4. `await isProjectVisibleToCaller(...)` — DB query, when
   `requireVisibility`

Each waits for the previous. Supabase is remote (~20 ms ping, but Auth
and PostgREST calls measure far higher), so this is 4 serial
round trips of pure overhead before the action's real work begins.
`proxy.ts` has *already* validated the same user on the same request via
`updateSession`, so identity is established at least twice per request.

## The dependency graph — read this before restructuring

- Step 1 (`getUser`) and step 2 (`resolveWorkspace`) are **independent**.
  `resolveWorkspace(parsed.data, admin)` takes the parsed input and the
  admin client; it does not use `user`. These two can run concurrently.
  That alone removes one full round trip from every action in the app.
- Step 3 depends on BOTH 1 (`user.id`) and 2 (`workspaceId`).
- Step 4 depends on 3 (`membership.role`).

So the minimum honest sequential depth is `max(1,2) → 3 → 4`. Going
further means collapsing 3 and 4 into a single database call.

## Scope

1. **Run steps 1 and 2 concurrently (AS-081).** `Promise.all`, keeping
   each failure returning exactly the error it returns today — including
   which error wins when both fail. Decide that precedence deliberately
   and state it in the handoff; do not let it fall out of Promise
   ordering by accident.
2. **Resolve identity once per request (AS-083).** Wrap the
   `createClient()` + `getUser()` pair in React's `cache()` so repeated
   call sites within one request share one result. `cache()` is already
   used in `lib/queries/projects.ts` — follow that precedent.
3. **Consider collapsing steps 3 and 4 into one round trip** — a single
   database function returning membership role and project visibility
   together. Do this only if it can be done without duplicating the
   authorization logic in two places (SQL and TypeScript both deciding
   who may act is exactly how these rules drift apart). If you judge
   the duplication risk too high, say so in the handoff and stop after
   items 1 and 2 — that is an acceptable outcome, not a failure.
4. **Measure before and after (AS-085).** Record the same actions from
   the table above, from the dev server's own log lines, and put the
   real numbers in the handoff. An unmeasured performance change is a
   guess.

## Hard constraints — this is the authorization boundary

- **Never substitute `getSession()` for `getUser()` (AS-084).**
  `getSession()` does not verify the JWT. It is the obvious way to make
  this "faster" and it is a real security downgrade. Do not do it, and
  do not let a caching layer end up doing it indirectly.
- **No check may be removed, reordered into irrelevance, or made
  conditional** to save a call. This is a latency change only: the same
  callers must be refused, with the same messages (AS-082).
- **Run the full authorization test suite**, not only tests that look
  related. Every `authz`, RLS, role, visibility, guest, viewer, and
  client-role test must pass unchanged. If any test needs editing to
  pass, stop — that means behaviour changed, and behaviour must not.
- `cache()` is per-request. Confirm it cannot leak an identity across
  requests, and say in the handoff how you confirmed it. Getting this
  wrong would serve one user's data to another — it is the single
  highest-risk part of this feature.

## Out of scope

- `proxy.ts`'s own `updateSession` call — Supabase's SSR pattern needs
  it for token refresh. Removing it is a separate question with its own
  risks; do not touch it here.
- `getNotificationSnapshot`'s call frequency — a separate feature.
- Query/index tuning inside individual actions.
- The ~2,042 leftover test workspaces and ~10,000 stale `task_types`
  rows in the shared database (found during F116). Real, worth cleaning,
  not this feature.

## Definition of done

- AS-081–AS-085 each verified; AS-085 with actual recorded numbers
  before and after, from the same actions.
- Full authorization/RLS/role test suite passes with no test edited.
- The handoff states plainly whether item 3 was done or deliberately
  skipped, and why.
