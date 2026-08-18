# M2 — Scrutiny Recheck (scoped re-verification of F094–F099)

Adversarial, read-only re-verification of exactly the 6 findings from `M2-scrutiny.md`
(3 blocker: AS-006, AS-018, AS-001; 3 major: AS-005, AS-007, AS-022), covered by
handoffs F094–F099. Each verdict below is based on independently reading the actual
code/migrations/tests, not on trusting the handoff narratives.

## Per-finding verdicts

| # | Assertion | Original | Fix (handoff) | Recheck verdict | Basis |
|---|---|---|---|---|---|
| 1 | AS-006 | FAIL (blocker) | F095 | **PASS** | `supabase/migrations/20260817234323_workspace_create_rpc.sql` adds `create_workspace_with_owner` — a `security definer` `plpgsql` function that does the `workspaces` INSERT and the owner `workspace_members` INSERT in one function body (single implicit transaction, auto-rollback on failure). The migration drops `workspaces_insert_authenticated` (`with check (true)`) and runs `revoke insert on workspaces from authenticated`. Postgres checks table-level grants before RLS policies, so a bare `authenticated`-role `.from("workspaces").insert(...)` is now rejected at the grant-check stage regardless of any RLS policy — confirmed by reading the migration SQL directly, not just the comment claiming it. `lib/actions/workspaces.ts`'s `createWorkspace` now calls `supabase.rpc("create_workspace_with_owner", ...)` on the session-scoped client (not admin), consistent with the function reading `auth.uid()` internally. No orphan-workspace path remains: the RPC is structurally the only way to create a workspace row. |
| 2 | AS-018 | FAIL (blocker) | F094 | **PASS** | `supabase/migrations/20260817234900_remove_member_atomic_owner_guard.sql` adds `remove_workspace_member`, a `security definer` function. It locks the target row (`SELECT ... FOR UPDATE`), and when the target's role is `owner`, additionally locks *all* active-owner rows for the workspace (`SELECT ... FOR UPDATE`) before counting them and only then deletes. This is genuine row-level pessimistic locking inside one function invocation/transaction — not a check-then-act app-level recheck. A second concurrent call targeting the same workspace's owners blocks on the `FOR UPDATE` lock until the first transaction commits or rolls back, then re-reads the post-delete state, closing the TOCTOU window at the SQL level. `lib/actions/workspaces.ts`'s `removeMember` now calls this via `admin.rpc("remove_workspace_member", ...)` as the actual enforcement (the earlier app-level lookup is explicitly UX-only per code comment). Confirmed by reading the migration SQL, not just trusting the "10/10 concurrency test passed" claim in the handoff. |
| 3 | AS-001 | FAIL (blocker) | F096 | **PASS** | `tests/integration/proxy-auth-guard.test.ts` imports the real `proxy` export from `@/proxy`, constructs real `NextRequest` objects (`new NextRequest(...)`) for `/w/acme`, `/w/acme/projects/123/board`, `/w/`, `/w/ACME`, calls `await proxy(request)`, and asserts a real `Response` with status 307/302 and `Location: https://example.com/sign-in`. Non-redirect cases (`/`, `/sign-in`) are asserted the same way through the same real `proxy()` call. `@supabase/ssr`'s `createServerClient` is mocked only at the network boundary (`getUser` returns `null` user) so `proxy.ts`'s own `requiresAuth` check and `NextResponse.redirect` construction execute for real, not just the isolated helper. A separate test block also asserts `config.matcher`'s actual regex string matches `/w/*` paths and excludes `_next/static`/`_next/image`/`favicon.ico`. This directly closes the original gap (the old unit test never built a NextRequest, never called `proxy()`, never asserted a redirect). |
| 4 | AS-005 | FAIL (major) | F097 | **PASS** | `app/(workspace)/onboarding/page.tsx` now calls `getDefaultWorkspaceSlug(supabase, user.id)` (new `lib/queries/workspaces.ts` helper, shared with the auth callback route) and `redirect(`/w/${slug}`)` when the signed-in user already has an active membership; the create-workspace form only renders when no active membership exists. `getDefaultWorkspaceSlug` genuinely queries `workspace_members` (`status = 'active'`, ordered by `created_at desc`, `limit(1)`) then resolves the workspace's slug — not a stub. `tests/unit/onboarding-membership-gate.test.ts` covers both directions (redirect-with-membership, form-with-none) via a mocked Supabase client. This closes the original gap where the page was unconditionally reachable regardless of membership state. |
| 5 | AS-007 | FAIL (major) | F099 | **PASS** | `lib/actions/workspaces.ts`'s new `findAuthUserByEmail` helper loops `admin.auth.admin.listUsers({ page, perPage: 1000 })`, following the response's `nextPage` until `null` or a match, with a defensive `maxPages = 1000` runaway cap — genuine pagination, not a single capped call. `inviteMember` now calls this instead of a raw unpaginated `listUsers()`. `tests/unit/invite-member-pagination.test.ts` mocks `listUsers` to force 50-per-page regardless of requested `perPage` (so it can't be satisfied by just requesting a larger page size) and asserts matches are found on page 3 of 130 users and on the last page of 214 users, plus a no-match case with 87 users — this would fail if the pagination loop regressed to a single-page call. Confirmed the loop logic directly in `workspaces.ts`, not just trusting the test description. |
| 6 | AS-022 | FAIL (major) | F098 | **PASS** | `app/(workspace)/w/[workspaceSlug]/layout.tsx` now has `export const dynamic = "force-dynamic";` at module scope. Verified independently via a fresh `npm run build` in this recheck (not reusing the handoff's claimed output): the Route table shows `ƒ /w/[workspaceSlug]` (dynamic/server-rendered), not `○` (static). `tests/unit/sign-out-back-navigation.test.ts` was rewritten to import the layout module directly and assert `layoutModule.dynamic === "force-dynamic"`, i.e. it tests the actual mechanism present, not a re-test of `proxy()` under a fabricated request as before. |

## Overall verdict: **GREEN**

All 6 findings from `M2-scrutiny.md` are genuinely closed at the code level — verified
by reading the actual migrations, action code, layout/page code, and test assertions,
not by trusting handoff claims. No regressions found in the full suite.

## Full command output (this recheck run)

### `npx vitest run` — PASSED (exit 0)

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.10 /Users/sasajapranin/Desktop/pm-app


 Test Files  20 passed (20)
      Tests  101 passed (101)
   Start at  02:33:53
   Duration  18.75s (transform 737ms, setup 0ms, import 1.23s, tests 102.51s, environment 1ms)
```

Note: the previous scrutiny run's `remove-member.test.ts` `afterAll` teardown timeout
(a live-Supabase-project cleanup latency issue, not an assertion failure) did not
reproduce in this run — all 20 test files, including that one, passed cleanly.

### `npx eslint .` — PASSED (exit 0)

No output; zero errors.

### `npx tsc --noEmit` — PASSED (exit 0)

No output; zero type errors.

### `npm run build` — PASSED

```
> pm-app@0.1.0 build
> next build

▲ Next.js 16.3.1 (Turbopack)
- Environments: .env
✓ Running next.config.ts took 13ms

  Creating an optimized production build ...
✓ Compiled successfully in 365ms
  Running TypeScript ...
  Finished TypeScript in 1000ms ...
  Collecting page data using 9 workers ...
  Generating static pages using 9 workers (0/7) ...
  Generating static pages using 9 workers (1/7)
  Generating static pages using 9 workers (3/7)
  Generating static pages using 9 workers (5/7)
✓ Generating static pages using 9 workers (7/7) in 149ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /auth/callback
├ ƒ /onboarding
├ ƒ /sign-in
├ ƒ /w/[workspaceSlug]
└ ƒ /w/[workspaceSlug]/settings/members


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

`/w/[workspaceSlug]` is confirmed dynamic (`ƒ`), corroborating AS-022's fix.

## Scope note

This recheck covers only the 6 findings above (per the scoping instruction). It does
not re-litigate the full M2 milestone: the original report's INCONCLUSIVE items pending
M3/M4 tables (AS-003, AS-010, AS-011, AS-017, AS-021, AS-042, AS-137–139, AS-144) and
the PASS items (AS-002, AS-004, AS-008, AS-009, AS-012–016, AS-019, AS-020, AS-023,
AS-024, AS-137–139, AS-143, AS-145) were not re-reviewed here and their original
verdicts stand as of `M2-scrutiny.md`.
