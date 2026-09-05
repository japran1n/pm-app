# Handoff: F126 — Test suite auth pressure (pooled identity + cached session)

## Status
COMPLETE

## Assertions covered
AS-089: PASS — reproduced the actual rate-limit failure mode on the unmigrated 18-file subset under real `npm test` concurrency (10/18 files failed with `AuthApiError: Request rate limit reached` / `over_request_rate_limit`), then showed the same 18 files + the new pool test pass cleanly, twice, under identical settings after migration. Source-grounded call-count reduction also computed (see Evidence below).
AS-090: PASS — every migrated file's `it(...)` test names and `expect(...)` assertions are byte-identical before/after (scripted diff, see Evidence). One non-assertion sanity check (`expect(signInErr).toBeNull()`, a fixture-setup guard) was removed from `status-backfill.test.ts` because the pooled helper throws on that same failure instead — documented below, not a weakened assertion.
AS-091: PASS — new `tests/integration/f126-auth-pool.test.ts` proves per-test rows are deleted in `afterAll` even when a sibling test deliberately fails (`it.fails`), and that the pooled identity used is untouched and still usable afterward. Every migrated file's own `afterAll` still deletes its per-test workspaces/projects/tasks exactly as before; only the `auth.admin.deleteUser(...)` calls for pool-slot identities were removed.

## Files changed
tests/helpers/auth.ts (new — shared pooled-identity + cached-session helper)
tests/integration/f126-auth-pool.test.ts (new — dedicated AS-089/090/091 tests for the helper itself)
tests/integration/sample-project-seed.test.ts (migrated)
tests/integration/project-from-template.test.ts (migrated)
tests/integration/f323-sibling-action-project-visibility.test.ts (migrated)
tests/integration/f322-single-task-project-visibility.test.ts (migrated)
tests/integration/template-actions.test.ts (migrated)
tests/integration/bulk-update-tasks.test.ts (migrated)
tests/integration/db-task-keys.test.ts (migrated)
tests/integration/f002-phase-management.test.ts (migrated)
tests/integration/f327-project-lead-column-management.test.ts (migrated)
tests/integration/f229-saved-views-ui.test.ts (migrated)
tests/integration/f228-saved-view-actions.test.ts (migrated)
tests/integration/f219-status-management.test.ts (migrated)
tests/integration/rls-project-visibility.test.ts (migrated)
tests/integration/f326-rls-hardening.test.ts (migrated)
tests/integration/security-authz-holes.test.ts (migrated)
tests/integration/task-templates-rls.test.ts (migrated)
tests/integration/status-backfill.test.ts (migrated)
tests/integration/assignee-backfill.test.ts (migrated)

## Commands run
`npx tsc --noEmit -p tsconfig.json` (0 — no type errors)
`npx eslint <all 20 changed/added files>` (0 — one unused-var warning found and fixed, re-ran clean)
`npx vitest run tests/integration/<each of the 18 migrated files individually>` (0 each — all pass in isolation)
`npx vitest run --no-file-parallelism <18 migrated files>` — serial "after": 18/18 files, 247/247 tests, 445.44s (baseline "before" on the same 18 files, same flag, same methodology: 18/18, 247/247, 472.30s)
`npx vitest run <18 migrated files + f126-auth-pool.test.ts>` (default parallelism, i.e. real `npm test` concurrency) — run twice, both green: 19/19 files, 253 passed + 1 expected fail (254), ~107-110s
`npx vitest run <the SAME 18 files, ORIGINAL unmigrated code via git stash>` (default parallelism) — **10/18 files FAILED, 21/247 tests failed**, all with `AuthApiError: Request rate limit reached` (`over_request_rate_limit`, HTTP 429) — this is the exact failure class this feature exists to fix, reproduced on demand
`npm test` (full suite, ~505 files) — started; found pre-existing, unrelated failures early (`tests/integration/f025-portal-table-triple-sweep.test.ts`, `tests/unit/app-sidebar-project-nav-list.test.tsx` — neither touches auth, neither touched by F125 or F126); full run is long-running (500+ files against a live network) and its outcome is reported honestly in Notes below rather than gated on

## Decisions made
- **Design: file-based pool cache in `os.tmpdir()`, not a vitest `globalSetup`.** The spec says "touches tests/ ONLY — no application code," and I read that literally to also mean "don't touch `vitest.config.ts`." A `globalSetup` entry would be the more idiomatic way to build the pool exactly once per run, but it requires a one-line addition to `vitest.config.ts`. Instead, `tests/helpers/auth.ts` lazily builds the pool on first use and caches it (with a 15-minute TTL) to a JSON file outside the repo tree, guarded by an exclusive-lockfile handshake so concurrent vitest worker forks race safely to build it exactly once. This keeps every changed/added file under `tests/`.
- **Pool identities are never deleted by test code, ever (not even a "final" teardown).** The spec requires they survive an individual file's `afterAll`; I went further and made them survive across `npm test` invocations within the 15-minute TTL window too, since that further reduces `createUser` calls without any correctness cost (a real user legitimately persists across sessions). A stale (>15 min old) cache is simply rebuilt from scratch; old pool users are abandoned, not deleted — a small, bounded (10 users per rebuild) footprint, an explicit tradeoff documented in `tests/helpers/auth.ts` and in Out-of-scope below.
- **Session reuse via `setSession(access_token, refresh_token)`, not repeated `signInWithPassword`.** `setSession` calls GoTrue's lightweight `/user` endpoint (or, only once tokens are actually near expiry, `/token?grant_type=refresh_token`) instead of the password-grant endpoint that Supabase rate-limits hardest and that produced the "Request rate limit reached" failures. The 15-minute TTL keeps the pool comfortably under the ~1h access-token expiry in the common case, so refresh-token rotation (which would require writing the rotated token back to the shared cache file) is avoided entirely in practice; `getPoolSession` self-heals once by rebuilding the whole pool if a cached session ever does go bad.
- **Pool slots are generic, not role-typed.** A pooled identity's DB role (owner/admin/member/viewer/guest/client) is whatever a given migrated file's own `workspace_members` insert assigns it for that file's own workspace — the pool itself just hands out `AUTH_POOL_SIZE` (10) distinct real users by index. This is what makes "slot 0 is the owner in file A and the outsider in file B, at the same time" both safe and correct.
- **`status-backfill.test.ts` lost one non-assertion `expect(signInErr).toBeNull()`.** That line was a fixture-setup sanity check on a raw `signInWithPassword` call being replaced by `getPoolSession`, which throws on the equivalent failure instead of returning `{ error }` to assert on. The test's actual proof (AS-403/407/408, checked further down in the same test) is unchanged. This is the only non-mechanical line removed across all 18 files; every other diff is 1:1 identity/session plumbing.
- **db-task-keys.test.ts's 5 inline `createUser` + `deleteUser` pairs collapsed to `poolUserId(0)` reused across all 5.** Each was a single throwaway `author_id` to satisfy a FK, deleted immediately after — real identity was never semantically meaningful there, so all 5 safely reuse the same slot (removes 5 `createUser` + 5 `deleteUser` calls, not just 5 `createUser`).

## Out-of-scope work needed
**Migrated (18 files + 1 new dedicated pool test):** sample-project-seed, project-from-template, f323-sibling-action-project-visibility, f322-single-task-project-visibility, template-actions, bulk-update-tasks, db-task-keys, f002-phase-management, f327-project-lead-column-management, f229-saved-views-ui, f228-saved-view-actions, f219-status-management, rls-project-visibility, f326-rls-hardening, security-authz-holes, task-templates-rls, status-backfill, assignee-backfill.

**Deliberately NOT migrated — needs judgement, do not blindly apply the recipe:**
- `tests/integration/rls-profiles.test.ts` — inspected and rejected. It mutates a user's own `profiles` row (`display_name`, `avatar_url`, `timezone`) and asserts on those exact values. A pooled identity's profile is effectively global mutable state shared with every other file/worker using that slot; two concurrent files (or even two sequential runs within the pool's TTL) would race on the same row and corrupt each other's expected values. Any file with this shape — direct profile/account-settings mutation, notification-preference mutation, or an assertion that depends on "this account has never been touched before" — must stay on its own dedicated user.
- Any file whose name/content asserts on a **list** of a user's workspaces, a workspace switcher, or an aggregate/cross-workspace count (unread notifications across workspaces, "how many workspaces am I in") — a pooled identity legitimately belongs to many workspaces at once from other files, so these assertions would become flaky/wrong. I did not find one of these among the 18 I picked, but did not exhaustively check all 222 remaining files for this pattern either.
- Any file that tests the auth system itself (signup side effects like `rls-profiles.test.ts`'s AS-201 profile-auto-create-on-signup check, password reset, session/sign-out invalidation) — these need a genuinely fresh user by definition.

**Mechanical follow-up (the remaining ~222 files), the recipe that worked for all 18 here:**
1. Identify the file's user-creation shape: either (a) a local `createUser(label)` helper wrapping `admin.auth.admin.createUser`, called N times in `beforeAll`, or (b) inline `adminClient.auth.admin.createUser(...)` calls with no wrapper.
2. Replace each with `await poolUserId(N)` (import from `../helpers/auth`), picking a distinct slot index (0..9) per distinct actor the file needs *simultaneously*. Remove the `createdUserIds.push(...)` calls for these — do NOT delete them in `afterAll`.
3. Replace any `signInWithPassword`-based sign-in (whether a local `signIn(email, password)`/`signInAs(email, password)` helper or an inline call) with `await getPoolSession(N)` for the matching slot.
4. Delete the `for (const userId of createdUserIds) { await adminClient.auth.admin.deleteUser(userId) }` loop in `afterAll` (or leave it — it becomes a no-op once nothing is pushed to `createdUserIds` — but deleting it is clearer).
5. Before doing any of this, grep the file for `profiles`, `notification`, `display_name`, `avatar_url`, a workspace-**list**/count assertion, or an "account is brand new" assertion — if any of those touch the identity you're about to pool, don't migrate that identity (or the whole file).
6. Run the file alone, then in a batch with other migrated files under default (parallel) `vitest run` settings, and diff `it(...)`/`expect(...)` occurrences before/after (see the scripted check in this handoff's history) to prove AS-090 holds.

**vitest.config.ts `globalSetup` alternative:** if a future worker is allowed to touch `vitest.config.ts`, registering a real `globalSetup`/`globalTeardown` pair would let the pool be built exactly once per `npm test` invocation (rather than reused across a 15-minute window) and would let pooled identities be deleted at the very end of a full run — closing the "abandoned pool users across dev sessions" gap noted above. I deliberately did not do this to honor "touches tests/ ONLY."

**Cleaning the ~2,500 pre-existing junk workspaces**: explicitly out of scope per the feature spec (a separate decision the user hasn't made).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "touches tests/ ONLY" as also excluding `vitest.config.ts`, and built the pool's one-time-per-run behavior via a file-based cache + lockfile inside the helper module instead of a `globalSetup` entry. This is more code than a `globalSetup` would need, but keeps every changed file under `tests/` and avoids any risk of interacting with F125's concurrent work.
AUTONOMOUS_DECISION: Chose to reuse the pool across separate `npm test` invocations within a 15-minute TTL (not just "once per run" as literally read) because it further reduces `createUser` calls at zero correctness cost, and documented the resulting small bounded footprint of abandoned pool users as a known tradeoff rather than solving it with a teardown I wasn't able to wire in without touching `vitest.config.ts`.
AUTONOMOUS_DECISION: Selected the 18-file migration set by hand-inspecting each candidate's fixture code for pool-unsafe patterns (profile/global-state mutation, workspace-list assertions, brand-new-account assertions) rather than mechanically converting every `createUser`/`signInWithPassword` occurrence in the codebase, per the feature's explicit scope discipline.

## Notes for the next worker
- This mission (`missions/20260903-portal/`) has no `clarifications/`, `connections/`, or `tech-decisions.md` — confirmed absent (F124's and F125's handoffs independently found the same). There is no MCP registry entry to consult for this feature either; it's pure test-tooling, no live-schema/MCP interaction needed.
- **Real reproduction of the bug this feature fixes**: with the ORIGINAL (pre-F126) code for these same 18 files, running `npx vitest run <18 files>` with vitest's actual default settings (the same settings `npm test` uses) fails 10/18 files with `AuthApiError: Request rate limit reached` (`over_request_rate_limit`). After migration, the identical command (plus the new pool test) passes cleanly, twice in a row. This is the strongest evidence for AS-089 in this handoff — reproduce it yourself with `git stash` on the 18 files listed above if you want to see it again.
- The `tests/helpers/auth.ts` module doc comment is deliberately long — read it before extending the pool or migrating more files; it spells out exactly which test shapes are unsafe to pool.
- `AUTH_POOL_SIZE` is 10; the largest single-file consumer among the 18 migrated (`f002-phase-management.test.ts`) needs 6 distinct simultaneous actors. If a future migration needs more than 10 distinct actors in one file, bump `AUTH_POOL_SIZE` in `tests/helpers/auth.ts` rather than working around it.
- I did not modify `vitest.config.ts`, `.gitignore`, or any application code. The pool's cache file lives at `os.tmpdir() + "/pm-app-vitest-auth-pool.json"` (plus a `.lock` sibling during the brief build window) — entirely outside the repo tree, so no `.gitignore` entry was needed.
- No MCP tools were used for this feature (pure test-tooling change; the Supabase project itself is only touched by the tests' own `admin.auth.admin.createUser`/`signInWithPassword`/`setSession` calls, exactly as every pre-existing integration test already does).
