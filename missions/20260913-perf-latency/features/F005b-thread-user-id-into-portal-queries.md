# F005b: Thread user id into portal queries

**Milestone:** M1 — Request-level deduplication

**Est:** 45 min · **Depends on:** F005
**Covers:** AS-004
- Created from F005's `SUGGESTED FOLLOWUP`. That worker left
  `lib/queries/portal.ts`'s two `auth.getUser()` calls alone rather than
  guess about preview mode — the correct call, and the reason this exists
- Swap both to `getCurrentUser()` **only if** the check below says the
  effective identity is what those call sites want
**Files:** `lib/queries/portal.ts`

## What the orchestrator already established

`createClient()` in `lib/supabase/server.ts` branches on the request's
cookies and nothing else. If `PORTAL_PREVIEW_ACCESS_COOKIE` and
`PORTAL_PREVIEW_REFRESH_COOKIE` are both present it mints a preview client
for the previewed client and wraps it read-only; otherwise it returns the
caller's own cookie-backed client. Those cookies are scoped to
`path: "/portal"`, so a `/w/*` request never carries them.

That makes one request single-identity by construction: previewer **or**
previewed, never both. `getRequestClient()` is `cache(createClient)`, so
memoising it per request cannot cross a boundary that does not exist within a
request. **The leak F005 was worried about is not possible.**

## The real question, which F005 did not get to

`lib/supabase/server.ts` exports **two** clients on purpose:

- `createClient()` — the *effective* identity. Under preview that is the
  previewed client.
- `createRealSessionClient()` — the previewer's own `/`-scoped session,
  deliberately ignoring the preview cookies. It exists for code that must act
  or audit as the actual signed-in person regardless of preview, e.g. the
  portal layout's per-entry audit write.

`getCurrentUser()` is built on `createClient()`, so it yields the *effective*
identity. Your job is to confirm that is what each of `portal.ts`'s two call
sites actually wants. If either one needs the real previewer — an audit
write, an attribution, a permission check about the person driving the
preview — then swapping it would be an impersonation bug, and that call site
must keep what it has. Say which you found, per call site, in the handoff.

## Clarification status

`[CLARIFIED-AUTO]`

## Notes for the worker

- Work **only** in `/Users/sasajapranin/Desktop/pm-app-perf` on branch
  `perf/latency`. `cd` there first and confirm with `pwd` and
  `git branch --show-current`. `/Users/sasajapranin/Desktop/pm-app` is the
  user's own checkout; they are using the app against it right now.
- Do **not** start a dev server, on any port.
- Read `lib/supabase/server.ts` end to end before you touch anything, and
  `missions/20260913-perf-latency/handoffs/F005-handoff.md` for context.
- Leaving one or both call sites unchanged, with the reason written down, is a
  perfectly good outcome. A slow portal page is a smaller problem than a
  request that resolves identity as the wrong person.
- Do not swap `getUser()` for `getSession()` anywhere.
- Verify with `missions/20260913-perf-latency/tools/test-gate.sh`.
- Handoff at `handoffs/F005b-handoff.md`, exact filename, with a line for
  AS-004. Commit as `feat(F005b): <summary> [assertions: AS-004]`.
