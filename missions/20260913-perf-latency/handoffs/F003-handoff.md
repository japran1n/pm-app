# Handoff: F003 — Workspace layout and header use the cached helpers

## Status
COMPLETE

## Assertions covered
AS-001: PASS — the workspace layout (`app/(workspace)/w/[workspaceSlug]/layout.tsx`) no longer calls `createClient()` + `supabase.auth.getUser()` itself; it calls `getCurrentUser()` from `@/lib/auth/current-user` (F001) and reuses the returned `{ supabase, user }` for its remaining queries. `components/nav/app-header.tsx` is switched the same way. Verified by reading the diff (no `createClient`/`auth.getUser` reference left in either file) and by the layout's guard test passing (`tests/unit/sign-out-back-navigation.test.ts`, 1/1). Not verified as an actual single network round trip across the two call sites within one real request — see "What this does not prove" below.
AS-002: PASS — the layout's `activeWorkspace` lookup now calls `getWorkspaceBySlug(workspaceSlug)` from `@/lib/queries/workspaces` (F002) instead of its own inline `.from("workspaces").select(...).eq("slug", ...).maybeSingle()`. The `workspace_slug_history` fallback branch (permanentRedirect for a renamed workspace) is kept exactly as before, as its own call-site query against `supabase` from `getCurrentUser()`, per F002's explicit instruction not to fold that into the shared helper. Verified by reading the diff and by the full gate run passing.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
components/nav/app-header.tsx

## Commands run
`npx vitest run tests/unit/sign-out-back-navigation.test.ts` (0, 1/1 passed)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches accepted baseline)

## Decisions made
- Kept the `workspace_slug_history` redirect branch entirely unchanged, still using the `supabase` client obtained from `getCurrentUser()` (same instance `getWorkspaceBySlug` uses internally via `getRequestClient()`), per the spec's explicit "must not break" constraint #1 and F002's own handoff guidance.
- Kept `export const dynamic = "force-dynamic"` untouched (constraint #2) — not touched at all in this diff.
- Kept the membership gate (`workspaces_select_active_members` RLS + the `currentRole === "client"` redirect to `/portal/...`) in the layout body, running exactly where it did before, after the parallel `Promise.all` batch (constraint #3).
- `app-header.tsx`: replaced its own nested `createClient()` + `auth.getUser()` with `getCurrentUser()`, destructuring only `{ user }` since the header doesn't need the client itself for anything else in this file.
- Made no changes to `lib/auth/current-user.ts` or `lib/queries/workspaces.ts` themselves — out of scope per the spec ("Do not change the query helpers themselves").
- No behaviour change: same redirects (`/sign-in` for no user, `permanentRedirect` for renamed slugs, `notFound()` for missing/unauthorized, `/portal/...` for client role), same data shape returned to children, same query set in the `Promise.all` batch (untouched).

## Out-of-scope work needed
- The ~40+ other call sites under `app/(workspace)/w/[workspaceSlug]/**` (page.tsx, settings/*, chat/*, docs/*, projects/[projectId]/**, time/*, team/*, etc.) still call `supabase.auth.getUser()` and/or build their own `createClient()` + workspace-by-slug lookup directly — see F002's handoff "Notes for the next worker" for the full enumerated list. This feature's spec named only the layout and `app-header.tsx`; all the rest are F004/F005 territory (per F001's and F002's own handoffs) or a later "F007"-style sweep.
- The `(portal)/portal/[workspaceSlug]/**` route tree (~18 call sites) was not touched — flagged by F002 as needing its own separate pass, not named in this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — followed the spec and F001/F002 handoffs directly, no ambiguity encountered)

## Notes for the next worker
- How many `auth.getUser()` calls remain on a single workspace-page request path after this feature: the top-level workspace layout (F003, now fixed) and `app-header.tsx` (F003, now fixed) are the only two call sites this feature covers, and both are clean — a `grep -n "auth.getUser\|createClient" app/(workspace)/w/[workspaceSlug]/layout.tsx components/nav/app-header.tsx` at completion returns zero matches. However, every leaf page under that layout (e.g. `app/(workspace)/w/[workspaceSlug]/page.tsx`, `.../settings/page.tsx`, `.../chat/layout.tsx`, `.../docs/layout.tsx`, `.../projects/[projectId]/layout.tsx` and its many descendants, `.../my-tasks/page.tsx`, `.../calendar/page.tsx`, etc. — 40+ files) still calls `supabase.auth.getUser()` on its own client for THAT page's own request, on top of what the layout now does. A full `grep -rn "auth.getUser()" "app/(workspace)/w/[workspaceSlug]/"` after this change still returns ~44 hits, all in leaf pages/nested layouts, none in the top-level workspace layout or app-header.tsx. Under the real Next.js runtime, `getCurrentUser()`'s `cache()` wrapper means that if F004/F005 switch these remaining call sites over to `getCurrentUser()` too, they will all collapse onto the SAME memoised call the layout already made — so the "twelve calls" the mission's audit measured should collapse to one once F004/F005 land. This feature does not attempt that; it only covers the two files named in its own spec.
- What this handoff's testing proves: the layout and header no longer perform their own client construction/auth call, and the layout's slug-history/force-dynamic/membership-gate behaviour is byte-for-byte the same logic, just re-pointed at the shared helpers. What it does NOT prove (same caveat F001/F002 documented): that within one real Next.js request, the layout's `getCurrentUser()` call and any other page's `getCurrentUser()` call collapse into a single `auth.getUser()` network round trip — `cache()` doesn't memoise under plain Vitest, so no unit test in this repo can observe that dedup; it's guaranteed by React's `cache()` + Next's per-request dispatcher under the real runtime only, per the header comments in `lib/auth/current-user.ts` and `lib/queries/workspaces.ts`.
- No MCP tools were used for this feature — pure code refactor of two files, no live schema/policy interaction, no new database object touched.
