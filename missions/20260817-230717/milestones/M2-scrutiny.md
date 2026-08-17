# M2 — Auth & Workspace — Scrutiny Report

Adversarial, read-only review. Reviewer had not seen the implementation before. 18 features (F006–F023) reviewed by 18 independent parallel subagents, each given only assertion text + files-changed (no handoff narratives). Full test/lint/typecheck run separately below.

## Assertion verdicts

| Assertion | Verdict | Reason |
|---|---|---|
| AS-001 | FAIL | `proxy.ts`'s `requiresAuth` matcher logic looks correct, but the only test (`tests/unit/proxy-auth-guard.test.ts`) calls the isolated `requiresAuth` helper directly — it never builds a real `NextRequest`, never invokes `proxy()`, never asserts a redirect happens, and never verifies Next.js's `config.matcher` actually routes `/w/*` through the guard. AS-001 as literally worded ("a visitor... is redirected... when visiting any /w/* route") is unverified by any test. Whether Next.js 16's `proxy.ts` convention is even real (vs. an incorrect assumption in a code comment) is unconfirmed by the code itself. |
| AS-002 | FAIL | `signInWithMagicLink` correctly calls `supabase.auth.signInWithOtp`, but `tests/unit/sign-in-schema.test.ts` only tests the zod schema in isolation — it never imports or calls the action, never mocks Supabase. The action's actual magic-link-sending behavior could be deleted entirely and every test would still pass. Also: no try/catch around the Supabase call, so a thrown error (vs. a returned `.error`) crashes the Server Action instead of showing the intended generic message. |
| AS-003 | INCONCLUSIVE | No test exists anywhere for `app/(auth)/auth/callback/route.ts`. Code-review-only: happy path is correct (re-verifies user via `getUser()`, no open-redirect). But "default workspace" = most-recently-created active membership, not an explicit default flag — a newly-invited long-time member gets silently routed away from their usual workspace. DB-error branches on membership/workspace lookup are swallowed (logged only) and treated identically to "no membership," silently bouncing an existing member to `/onboarding`. `activateInvitedMemberships` call is unguarded — a throw produces a raw 500 instead of the graceful redirect pattern used everywhere else in the file. |
| AS-004 | PASS | `tests/unit/sign-in-expired-link.test.ts` genuinely exercises `SignInPage`'s rendering logic against different `searchParams` and would fail if the error-detection logic broke. Minor real gap: "resend" is just the ordinary sign-in form, not a differentiated resend action, and any `error` value other than the literal string `auth_failed` renders no message at all (silent for unknown error codes) — acceptable per assertion text but worth noting. |
| AS-005 | FAIL | Callback-route redirect logic is server-checked and correct. But `app/(workspace)/onboarding/page.tsx` itself performs **no** membership check — it is explicitly documented as reachable by any authenticated user at any time, including one who already has workspaces. The "no membership → prompted" guarantee holds only for the one entry path (post-sign-in redirect); revisiting `/onboarding` directly bypasses the condition entirely. |
| AS-006 | FAIL (blocker) | Happy path is correctly tested against a live DB (`tests/integration/create-workspace-owner.test.ts`). But: (1) no test exercises the compensating-rollback failure path, and if both the membership insert AND the rollback delete fail, an ownerless workspace is silently left behind (logged only) — exactly the scenario the code's own comments claim can't happen; (2) the RLS policy `workspaces_insert_authenticated` (`with check (true)`) lets *any* authenticated user insert a `workspaces` row directly via the Supabase API, bypassing the Server Action entirely — since `workspace_members` has zero INSERT policy for `authenticated`, such a workspace can never get an owner and permanently squats a slug. The "creator becomes owner" guarantee is enforced only by application code, with no RLS backstop, and has a demonstrated orphan path. |
| AS-007 | FAIL (major) | Authorization (owner+admin allowed, member/unauthenticated rejected, re-verified server-side via fresh DB query) is solid and well tested, including explicit negative/authorization tests. However, the "already-active member" duplicate-invite check calls `admin.auth.admin.listUsers()` with no pagination — Supabase defaults to 50 users per page — so in any instance with >50 registered users, an already-active member (with no `invited_email` set, e.g. an owner from F013) can be silently re-invited, creating an inconsistent duplicate `workspace_members` row. Untested at any user-count scale. |
| AS-008 | PASS | Email used to match invites is derived from the server-verified session (`supabase.auth.getUser()`), never from client input — no auth-bypass vector. Activation is race-safe (per-row `UPDATE ... WHERE user_id IS NULL` re-check), confirmed by an actual concurrency test (`Promise.all`). Multi-workspace invites all activate correctly. Real gap: no test exercises the callback route itself, so a future regression that starts trusting a client-supplied email would not be caught by anything in this suite — protection currently rests on code inspection, not a regression test. |
| AS-009 | PASS | Un-activated invite rows correctly retain `status='invited'`, `user_id IS NULL`, confirmed by test. Note: this invariant depends entirely on every future consumer (F017's members list) remembering to filter by `status`; nothing at the DB/type level enforces it — a latent risk flagged for F017, not a defect in F016 itself. F017 itself (see AS-023) was independently confirmed to filter correctly. |
| AS-010 | INCONCLUSIVE | Verified for the two tables that exist today (`workspaces`, `workspace_members`) via genuine RLS-enforced integration tests (real second auth user, real anon-key queries, not service-role masking). But AS-010's text explicitly names "projects, tasks, or members" — projects/tasks tables don't exist yet in M2. The assertion cannot be considered fully verified until those tables and their RLS land (M3/M4); it is only partially demonstrated at this milestone. |
| AS-011 | INCONCLUSIVE | Same finding as AS-010 — the direct-Supabase-client-call rejection is genuinely tested for workspaces/workspace_members with a real non-member session, but the assertion's implicit scope (any workspace-scoped table) exceeds what exists in M2. |
| AS-012 | PASS | Switcher list is scoped via `.eq("user_id", user.id)` plus `workspace_members_select_fellow_members` RLS — no leak path found. Test coverage is real-DB but bypasses the actual component tree (queries mirror the layout's query rather than rendering it), so a regression in the component itself (e.g., swapping to a service-role client, deleting the `notFound()` guard) would not be caught by the test suite even though current behavior is correct. |
| AS-013 | PASS | Switching uses a real `<Link href="/w/{slug}">` triggering full Next.js navigation and a fresh server-component render — no client-only stale-state risk found. |
| AS-014 | PASS | `requireWorkspaceOwner` correctly restricts to owner only (not admin), re-verified server-side from a fresh DB read each call, no client-trust gap. IDOR-safe (target lookup scoped by both id and workspace_id). Well tested with real DB state assertions. |
| AS-015 | PASS | Member and admin are both correctly rejected server-side (matches AS-015's literal member-rejection plus the intended admin-exclusion cross-checked against AS-014). Server-side re-check independent of UI gate, confirmed by tests. |
| AS-016 | PASS | Owner can remove members; authorization re-verified server-side, IDOR-safe, tested against real DB state. |
| AS-017 | INCONCLUSIVE | Test only confirms the `workspace_members` row is deleted via a direct admin-client query — it never simulates the removed user's actual next authenticated request through RLS to confirm access is truly denied end-to-end. Plausible given the RLS design reviewed under AS-010/011, but not independently proven for this specific flow. |
| AS-018 | FAIL (blocker) | Sole-owner guard exists (`count active owners` then conditionally delete) but is check-then-act with **no transaction, no DB-level constraint, and no delete-clause tying the removal to the precondition**. Two concurrent removal requests against a 2-owner workspace can both read count=2, both pass, both succeed — leaving zero owners (TOCTOU race). No DB trigger/constraint backstops this; it is the sole application-code guard. The test suite never exercises concurrent removal, so this race is invisible to CI. Additionally, no test covers the explicit "owner demotes themselves" half of AS-018's wording. (Note: the sibling change-member-role action, F019, closes the equivalent gap correctly and safely by making "owner" structurally unreachable as a role-change target — remove-member's count-based guard is the weaker, racy design by comparison.) |
| AS-019 | PASS | Admin correctly allowed to invite/remove members (verified in F015/F020 reviews) and correctly blocked from workspace deletion by `requireWorkspaceOwner`-only gating in F021 (see AS-020). |
| AS-020 | PASS | Delete-workspace action strictly requires owner role (excludes admin, unlike a naive "not a plain member" check). |
| AS-021 | INCONCLUSIVE | Soft-delete of the workspace itself is implemented (sets a flag, not a hard DELETE — schema has `deleted_at`). But the "and all its projects and tasks" cascade half of the assertion is **not implementable or verifiable at this milestone** — projects/tasks tables don't exist until M3/M4. This should not be marked PASS on the strength of F021 alone; a follow-up verification is required once those tables land. |
| AS-022 | FAIL (major) | Server-side cookie/session clearing on sign-out is real and correct. But the "navigating back does not show cached workspace data" half is **not actually satisfied**: no `Cache-Control: no-store`/`force-dynamic` is set anywhere on the workspace layout or in `next.config.ts` (confirmed via repo-wide grep), so browser bfcache can restore the previously-authenticated page on back-navigation with zero network request — `proxy.ts`'s guard never runs in that path. The dedicated `tests/unit/sign-out-back-navigation.test.ts` does not test this; it re-tests the proxy redirect under a fabricated cookie-less request and its own doc comment's reasoning about why bfcache "doesn't apply" is incorrect. |
| AS-023 | PASS | `lib/queries/members.ts` correctly and mutually-exclusively separates active vs. pending by `status`; genuine RLS-backed integration tests confirm both positive and negative membership in each list, plus cross-workspace isolation. |
| AS-024 | PASS | Authorization (owner+admin), IDOR-scoping (workspace_id + id), and status-guarding (`invited` only, can't accidentally revoke an active membership) are all correct and covered by real-DB negative tests including a genuine cross-workspace IDOR test. |
| AS-042 | INCONCLUSIVE | The mechanism this milestone builds (RLS-backed workspace scoping, generic across resource types via `is_active_workspace_member`) is architecturally sound and not hardcoded/stubbed. But AS-042 is literally about the *project list*, which doesn't exist until M3 — cannot be marked PASS until F027 (project-list-page) actually exists and is tested against workspace-switching. |
| AS-137 | PASS (partial scope) | RLS is enabled (`ENABLE ROW LEVEL SECURITY`) on both tables that exist (`workspaces`, `workspace_members`); no policies-without-RLS-enabled gap found. Same caveat as AS-010: full assertion scope ("every table containing workspace-scoped data") isn't fully evaluable until M3+ tables exist. |
| AS-138 | PASS (partial scope) | Genuinely tested with real anon-key queries against a live project returning zero rows with no error, for the two existing tables. Same M3+ scope caveat applies. |
| AS-139 | PASS (partial scope) | Join-direction tested both ways for the two existing tables using a real non-member authenticated session (not service-role). The literal "selecting tasks by project_id" scenario in the assertion text cannot be tested until `tasks`/`projects` exist. |
| AS-143 | PASS | `require-membership.ts` re-fetches the caller's membership/role from the DB on every call using the admin (RLS-bypassing) client, never trusting client-supplied role/workspace claims — confirmed used consistently across F015/F018/F019/F020/F021. This is genuine defense-in-depth, not RLS-only. |
| AS-144 | PASS (with a coverage caveat) | Both "workspace doesn't exist" and "exists but not a member" collapse to the same single query and the same `notFound()` call in `layout.tsx` — no distinguishable outward response, no timing-observable branch. However, the assigned test (`workspace-not-found-scope.test.ts`) only replicates the underlying Supabase query in isolation — it never renders `layout.tsx` or hits a real route, so a future edit that adds divergent branching after the query (logging aside) would not be caught. No test for malformed/oversized/SQL-injection-shaped slugs, though the query shape (parameterized `.eq()`, no UUID cast) makes this low-risk by construction. |
| AS-145 | PASS | Explicitly documented via code comments in `lib/actions/auth.ts` and `lib/validation/auth.ts` (reliance on Supabase's built-in throttling, not reimplemented) — genuinely addressed, not silent, though inherently unenforceable/untestable by design (matches the assertion's own "not required for v1" framing). |

## Severity of failures

- **Blocker**: AS-006 (ownerless-workspace orphan path via direct RLS insert + unhandled rollback failure), AS-018 (TOCTOU race can zero out workspace owners), AS-001 (core auth-guard assertion literally untested — cannot rule out a routing gap with confidence).
- **Major**: AS-005 (onboarding page has no membership gate of its own), AS-007 (unpaginated `listUsers()` can silently duplicate/desync membership at >50 users), AS-022 (bfcache can show authenticated data after sign-out on back-navigation).
- **Minor/Inconclusive-pending-scope**: AS-003, AS-010, AS-011, AS-017, AS-021, AS-042, AS-137–139, AS-144 (all either need M3+ tables to be fully verifiable, or have a real-behavior test gap without a demonstrated live bug).

## Recommended follow-up features

**follow-up-sole-owner-atomic-guard**: Replace the check-then-act sole-owner guard in `removeMember` (`lib/actions/workspaces.ts`) with an atomic, race-safe mechanism — either a single SQL statement that conditions the delete on the live owner count (e.g. `DELETE ... WHERE id = $1 AND (SELECT count(*) FROM workspace_members WHERE workspace_id = $2 AND role='owner' AND status='active') > 1`), a Postgres constraint/trigger that rejects any transaction leaving zero active owners, or an advisory lock around the check-and-delete. Add a concurrency test that fires two simultaneous `removeMember` calls against a 2-owner workspace and asserts at least one owner survives. Also add an explicit self-removal test for the sole owner.

**follow-up-workspace-insert-rls-hardening**: Close the orphan-workspace path: either restrict the `workspaces_insert_authenticated` RLS policy so a bare `INSERT` can never succeed without a paired owner-membership row (e.g. move workspace creation fully behind a SECURITY DEFINER RPC/function that does both inserts atomically in one statement, replacing the current two-step admin-client sequence in `createWorkspace`), or add a background reconciliation job that detects and either completes or removes ownerless workspaces. Add a test that induces the rollback-delete failure path and asserts no permanent orphan remains.

**follow-up-onboarding-membership-gate**: Add a server-side check to `app/(workspace)/onboarding/page.tsx` consistent with AS-005's literal condition ("no existing workspace membership"), or update the assertion text if "create an additional workspace" is intentionally in scope for that route — currently the page is unconditionally reachable regardless of membership state, which doesn't match the assertion as written.

**follow-up-proxy-guard-integration-test**: Add an integration-style test that builds a real `NextRequest` for a representative set of `/w/*` paths (including nested and case-variant paths) with no auth cookie, invokes the actual `proxy()` export, and asserts a redirect to `/sign-in`. Add a matcher-regex test asserting `/w/anything` matches the exported `config.matcher`. Independently confirm against Next.js's actual documentation that `proxy.ts` is a real, wired-in convention rather than an assumption recorded only in a code comment.

**follow-up-signout-cache-headers**: Add `export const dynamic = "force-dynamic"` (or equivalent `Cache-Control: no-store`) to the workspace layout/pages so that back-navigation after sign-out cannot be served from browser bfcache without a fresh server round-trip through the auth guard. Rewrite `tests/unit/sign-out-back-navigation.test.ts` to assert on response cache-control headers (or an end-to-end/browser-level bfcache check) rather than re-testing the proxy redirect logic under a fabricated request.

**follow-up-invite-listUsers-pagination**: Fix the unpaginated `admin.auth.admin.listUsers()` call in `inviteMember` (`lib/actions/workspaces.ts` ~line 222) to paginate through all users (or query by email directly if the Admin API supports it) so the "already active member" duplicate-invite check doesn't silently fail once the user base exceeds 50 registered accounts. Add a test (can mock the admin client) simulating a >50-user account list.

**follow-up-sign-in-action-behavioral-tests**: Add a real behavioral test for `signInWithMagicLink` (`lib/actions/auth.ts`) that mocks/stubs the Supabase client and asserts `signInWithOtp` is actually invoked with the submitted email, and that a thrown (not just returned-error) failure is caught and surfaced as the generic error message rather than crashing the Server Action. The current `tests/unit/sign-in-schema.test.ts` only tests the zod schema and would not catch a broken or deleted magic-link call.

**follow-up-callback-route-tests-and-hardening**: Add a test suite for `app/(auth)/auth/callback/route.ts` (currently untested by anything in the repo). Cover: DB-error-during-membership-lookup should not silently masquerade as "no membership" (currently redirects to onboarding either way); wrap `activateInvitedMemberships` in a try/catch consistent with the rest of the file's graceful-redirect error handling instead of letting it throw a raw 500; consider adding an explicit `is_default` flag or "most recently active" tracking instead of relying on `created_at DESC` as an implicit default-workspace heuristic.

**follow-up-rls-and-cascade-verification-at-m3-m4**: Once `projects` and `tasks` tables and their RLS policies land (M3/M4), re-verify AS-010, AS-011, AS-042, AS-137, AS-138, AS-139 against the full literal assertion text (which explicitly names projects/tasks/comments/attachments), and verify AS-021's soft-delete cascade to projects/tasks actually executes correctly once those tables exist — do not consider these PASS on M2 evidence alone.

---

## Test / lint / typecheck output

### `npx vitest run` — FAILED (exit 1)

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.10 /Users/sasajapranin/Desktop/pm-app

 ❯ tests/integration/remove-member.test.ts (8 tests) 28664ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/integration/remove-member.test.ts > removeMember (F020: AS-016, AS-017, AS-018)
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ tests/integration/remove-member.test.ts:73:5
     71|     });
     72|
     73|     afterAll(async () => {
       |     ^
     74|       for (const workspaceId of createdWorkspaceIds) {
     75|         await adminClient
...

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 16 passed (17)
      Tests  85 passed (85)
   Start at  01:33:21
   Duration  28.93s (transform 759ms, setup 0ms, import 1.30s, tests 150.25s, environment 1ms)

VITEST_EXIT=1
```

Note: all 85 individual test assertions passed — the failure is a cleanup-hook timeout in `remove-member.test.ts`'s `afterAll` (workspace teardown against the live Supabase project taking >10s), not a test assertion failure. This is itself a real defect: an `afterAll` timeout in a test file that is also the file most relevant to AS-018 (the sole-owner-guard) means teardown reliability for exactly the highest-risk test suite in this milestone is compromised, and leaked/undeleted test workspaces may accumulate in the linked Supabase project across CI runs.

### `npx eslint .` — PASSED (exit 0)

No output; zero errors.

### `npx tsc --noEmit` — PASSED (exit 0)

No output; zero type errors.
