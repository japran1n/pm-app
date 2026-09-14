# Phase 2 — Supabase

Live project `qcipqonnqajmazdbysow` inspected via the Supabase MCP (`get_advisors`, `execute_sql` against `pg_policies`/`pg_proc`/`storage`). This is the strongest area of the codebase — unusual for AI-generated code.

## 2a. Advisors

**Security — zero ERROR-level findings.** Full list:
- WARN `anon/authenticated_security_definer_function_executable` — 71 SECURITY DEFINER functions in `public` callable via PostgREST RPC (18 by `anon`, 53 by `authenticated`). See SEC-003.
- WARN `auth_leaked_password_protection` disabled. See SEC-002.
- WARN `extension_in_public` — `btree_gist` installed in `public` (cosmetic; move to `extensions`).
- INFO `rls_enabled_no_policy` on `_realtime_capability_probe` and `f016i_gated_function_oids` — internal plumbing tables, RLS on + no policy = deny-all, which is safe.

Notably **absent**: `rls_disabled_in_public`, `policy_exists_rls_disabled`, `security_definer_view`, `auth_users_exposed`, `function_search_path_mutable`, `rls_references_user_metadata`, `auth_rls_initplan`. I additionally verified by SQL that every SECURITY DEFINER function pins `search_path` (0 without it) and no policy references `user_metadata`.

**Performance advisors**: WARN `multiple_permissive_policies` on 29 table/action pairs — systematic `_select_team` + `_select_client` policy pairs (see SEC-004); INFO 3 unindexed FKs (`brief_answer_revisions.changed_by`, `brief_answers.answered_by`, `briefs.doc_id`); INFO 16 unused indexes.

## 2b. Schema & migrations

- 260 migration files in `supabase/migrations` and **exactly 260 applied** in `supabase_migrations.schema_migrations` — no drift. The repo even ships its own drift checker (`scripts/check-migration-drift.mjs`, wired as `npm run migrations:check`).
- Generated types exist (`lib/supabase/database.types.ts`, 4702 lines) with a regeneration script (`npm run db:gen-types`). Freshness not diffed (would need CLI + network project access beyond MCP); the 0-error strict `tsc` over 218 typed query sites makes gross staleness unlikely.

## 2c. RLS matrix

69 tables in `public`, **RLS enabled on all 69**, 245 policies. Rather than paste a 69×4 grid, the shape:

- Every domain table carries per-operation named policies of the pattern `<table>_<op>_<audience>` (`_active_members`, `_team`, `_client`, `_admins`, `_own`). Tenancy is enforced through a shared set of SECURITY DEFINER helper predicates (`is_active_workspace_member`, `is_project_workspace_writer`, `is_task_visible_to`, `client_gate`, …) — workspace/project-scoped, not just `auth.uid()`.
- **Exactly one effectively-`true` policy**: `workspace_slug_history_select_authenticated` (SELECT, `authenticated`, `true`) — any signed-in user can read all workspaces' historical slugs. Slug strings only; cross-tenant metadata leak of minimal sensitivity (SEC-005, low).
- Tables with **no UPDATE policy** (13): `audit_log`, `task_activity`, `brief_answer_revisions`, `attachments`, `comment_reactions`, `message_reactions`, `project_favorites`, `project_members`, `channels`, `active_timers`, `time_entries`, `metric_snapshots`, `project_scope_documents`, `task_dependencies`. Sampling the code paths, these are append-only/toggle tables or mutate via SECURITY DEFINER RPCs / admin client (e.g. `stop_timer_atomic`, `project_members` via invite acceptance) — consistent with deny-by-default design rather than gaps. Not verified for every one of the 13 (SEC-006, unproven-concern).
- No views or materialized views lacking `security_invoker` (SQL check returned none).
- Storage: 4 buckets — `avatars` (public), `task-attachments`, `chat-attachments`, `scope-documents` (private). All have real policies: path-prefix ownership for avatars (`split_part(name,'/',1)::uuid = auth.uid()`), membership-joined SELECT/INSERT for attachments, channel-membership for chat files, writer-role for scope docs. Public `avatars` bucket means avatar/logo URLs are world-readable if guessed — normal trade-off, listed as info.

## 2d. Client usage in code

- Exactly four client factories, one per kind: [lib/supabase/client.ts](lib/supabase/client.ts) (browser, publishable key), [lib/supabase/server.ts](lib/supabase/server.ts) (SSR cookies), [lib/supabase/proxy-helpers.ts](lib/supabase/proxy-helpers.ts) (middleware refresh), [lib/supabase/admin.ts](lib/supabase/admin.ts) (secret key). No ad-hoc `createClient` scattered elsewhere (checked by grep).
- `service_role`/secret-key reachability: `SUPABASE_SECRET_KEY` is read only in `admin.ts`, `dev-login`, and scripts. **None of the 72 files importing `supabase/admin` is a client component** (grep for `"use client"` across all importers: zero). Not in any `NEXT_PUBLIC_` var. The extension workspace even ships a CI check that its bundle contains no `sb_secret_` material (`extension/scripts/check-no-secret-key.mjs`).
- Auth verification: 218 `auth.getUser()` call sites; a central [lib/actions/authz.ts](lib/actions/authz.ts) explicitly documents *why* `getUser()` and never `getSession()` (AS-084). The ~21 `getSession(` hits are realtime-token hydration and comments about it, not trust decisions — spot-checked `lib/realtime/subscribe-when-authenticated.ts` and `app/(auth)/extension-connect/page.tsx` (token handoff, session already established).
- `proxy.ts` (Next 16's middleware): refreshes the session via `updateSession` per `@supabase/ssr` pattern, and **protects `/w/*` and `/portal/*` server-side**, with a documented fast-path when no auth cookie exists at all.
- Route handlers (`app/api/extension/*`): authenticate via `Authorization: Bearer` + `auth.getUser(token)`, CORS locked to `chrome-extension://<EXTENSION_ID>` — read directly in [app/api/extension/tasks/route.ts](app/api/extension/tasks/route.ts).
- Query hygiene: **2** `select('*')` in app code; 33 `.limit(` uses in queries/actions; 20 `Promise.all` batches in `lib/queries` (deliberate batching — recent perf mission). No queries-inside-`.map()` N+1 found in sampled hot paths (portal + list pages).
- Edge functions: **none** (no `supabase/functions/`; MCP not queried further — nothing to audit).

### [SEC-001] `/dev-login` mints sessions for any email using the admin API, gated only by NODE_ENV
- Severity: medium
- Area: security
- Location: app/dev-login/route.ts:21
- Evidence: `if (process.env.NODE_ENV !== "development") return 404;` then `admin.auth.admin.generateLink({type:"magiclink", email})` and sets the SSR auth cookie for whatever `?email=` is passed.
- Verified by: read the file
- Why it matters: a one-line guard is the only thing between production and unauthenticated login-as-anyone. `NODE_ENV` is reliably `"production"` on real hosts, so it is not exploitable as deployed — but it is a standing landmine: any future change that ships this route with a non-production NODE_ENV (preview envs run `next start` variants, custom Docker images, `NODE_ENV` accidentally unset) becomes full account takeover of arbitrary users.
- Fix: additionally require an explicit `DEV_LOGIN_ENABLED=true` env var (absent everywhere but local), or exclude the route from production builds entirely.
- Effort: S
- Confidence: high

### [SEC-002] Leaked-password protection disabled in Supabase Auth
- Severity: low
- Area: security
- Location: Supabase Auth settings (advisor `auth_leaked_password_protection`)
- Evidence: security advisor WARN, pasted above.
- Verified by: get_advisors
- Why it matters: clients sign in with passwords; compromised-password reuse is the cheapest account-takeover vector.
- Fix: enable HaveIBeenPwned check in Auth settings (dashboard toggle).
- Effort: S · Confidence: high

### [SEC-003] 71 SECURITY DEFINER RPCs exposed via PostgREST, 18 callable by `anon`
- Severity: medium
- Area: security
- Location: `public` schema functions (advisor list; e.g. `bulk_delete_tasks_atomic`, `create_notification`, `write_audit_log_entry`, `shares_workspace_with`)
- Evidence: advisors `anon_security_definer_function_executable` (18) and `authenticated_...` (53). Sampled `bulk_delete_tasks_atomic` source: it internally re-derives the caller's allowed ids from `auth.uid()` before acting — the pattern self-authorizes. The `anon`-callable 18 are boolean membership predicates taking uuids.
- Verified by: get_advisors + read function source via SQL
- Why it matters: the sampled functions authorize internally, but 71 is a large surface to keep correct forever, and each new `*_atomic` function is one forgotten `auth.uid()` check away from a cross-tenant write. `anon`-callable predicates also allow unauthenticated enumeration oracles (e.g. probing whether a uuid is a valid workspace with members) — low value to an attacker, nonzero. `create_notification` and `write_audit_log_entry` callable by any authenticated user means any signed-in user can forge notifications/audit entries **if** those functions don't internally restrict actor/workspace (not individually verified — 71 functions).
- Fix: `REVOKE EXECUTE ... FROM anon` on all 18 (nothing anonymous should call them); for `authenticated`, revoke on functions only ever called through server actions with the service key, and audit the remainder (especially `create_notification`, `write_audit_log_entry`, `ensure_task_type`) for internal caller checks.
- Effort: M
- Confidence: medium (sampled 1 of 71 sources in depth)

### [SEC-004] Systematic duplicate permissive policies (29 table/action pairs)
- Severity: low
- Area: performance
- Location: e.g. table `briefs` (3 SELECT policies), `tasks`, `comments`, all `project_*` tables — advisor list in 2a
- Evidence: performance advisor `multiple_permissive_policies`, count 29.
- Verified by: get_advisors
- Why it matters: every read on these tables evaluates both the `_team` and `_client` policy (each a SECURITY DEFINER helper call). On hot tables (`tasks`, `comments`) that is measurable per-row overhead; the pattern is structural so it will spread with each new table.
- Fix: merge each pair into one policy with `OR`, or accept the cost knowingly. Low urgency.
- Effort: M · Confidence: high

### [SEC-005] `workspace_slug_history` readable by any authenticated user
- Severity: low
- Area: security
- Location: policy `workspace_slug_history_select_authenticated` (`qual = true`)
- Evidence: only `true` policy in the DB (SQL scan of `pg_policies`).
- Verified by: SQL against pg_policies
- Why it matters: any signed-in user (including a client of an unrelated agency workspace) can enumerate every workspace's past slugs — workspace names are often client names. Minor cross-tenant metadata leak.
- Fix: scope to members of the workspace the slug belonged to (needed for redirects only within that workspace anyway).
- Effort: S · Confidence: high

### [SEC-007] Public `avatars` bucket also holds workspace logos
- Severity: info
- Area: security
- Location: storage bucket `avatars` (public=true); policies `workspace_logos_objects_*` write into `avatars/workspace-logos/...`
- Evidence: bucket list + policies, pasted in 2c.
- Why it matters: avatar and logo images are world-fetchable by URL. Standard practice; recorded so it's a decision, not an accident.
- Effort: — · Confidence: high

## 2e. Auth config observations
`ALLOW_USERNAME_LOGIN` (username→email resolution via admin API) is documented as default-on in development only — code path reads the env var; not a prod exposure as configured. No open-signup or email-confirmation settings visible in code/migrations; not audited (dashboard-side).
