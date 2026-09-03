# Handoff: F006b — Close the portal read-surface leaks

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `getPortalProjectOptions`, `getPortalRequests` (both the `projects` read and, via a new migration, the `client_requests` RLS policies) no longer return any id/name/row belonging to a `portal_enabled = false` project. Proven live against Supabase in `tests/integration/f003-portal-shell.test.ts` (new `describe.skipIf(!haveCreds)("Portal read-surface leaks (F006b: AS-007, AS-012)")` block, 6 tests), plus the pre-existing `tests/integration/client-requests-rls.test.ts` (11 tests, unchanged, still green) proving normal single-project behaviour is untouched.
AS-012: PASS — `getPortalLiveNow`'s `project_phases` lookup now filters `client_visible = true`, so a hidden phase's name never reaches the Live-now rail; falls through to the existing generic "Working on the project" label. Covered by `tests/unit/portal-overview-queries.test.ts` (rewrote the test that previously locked the defect in, added a new positive case and a new negative case) and the same live integration block above (`getProjectPhases` returning `[]` for a disabled project even when the phase itself is `client_visible = true`).

## Files changed
supabase/migrations/20260913010000_client_requests_portal_enabled_gate.sql (new)
lib/queries/portal.ts
tests/integration/f003-portal-shell.test.ts
tests/unit/portal-overview-queries.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260913010000_client_requests_portal_enabled_gate.sql` (0)
`npm run db:gen-types` (0, no diff — this migration adds no columns)
`npx vitest run tests/unit/portal-overview-queries.test.ts` (0, 14 passed)
`npx vitest run tests/integration/client-requests-rls.test.ts` (0, 11 passed)
`npx vitest run tests/integration/f003-portal-shell.test.ts` (0, 10 passed — 4 original F003 tests + 6 new F006b tests)
`npx vitest run tests/integration/f003b-relocate-portal-routes.test.ts tests/integration/f005-portal-pages.test.ts tests/integration/portal-phases-rls.test.ts tests/unit/portal-phases-query.test.ts tests/unit/portal-overview-live.test.tsx tests/unit/portal-overview-realtime-subscription.test.ts tests/unit/reconcile-portal-realtime-task.test.ts tests/unit/portal-approval-action.test.ts` (0, 83 passed — side-effect verification per Definition of done)
`npx tsc --noEmit` (0, clean)
`npm run lint` (0 errors, 20 pre-existing warnings unrelated to this change — same count/content as the M1 scrutiny report's own tooling output)

Full vitest suite deliberately NOT run, per instruction (manufactures Supabase auth rate-limit failures).

## Decisions made

- **Audit method:** read every exported function in `lib/queries/portal.ts` (1353 lines, whole file) and classified each by which of the five audited tables (`projects`, `tasks`, `project_phases`, `client_requests`, `attachments`) it touches and how that touch is gated. Full enumeration below. Traced every touch to its actual output, not just its query shape — e.g. `getPortalOverview`/`getPortalActivitySummary`/`getPortalFiles` all read `projects` with no `portal_enabled` filter, but I verified (by reading `tasks_select_active_members` and `is_task_visible_to` in `supabase/migrations/20260909010000_portal_foundations.sql:194-230`) that the *task and attachment* rows those functions actually expose are independently RLS-gated on `client_visible AND portal_enabled` for the client role, so a disabled project's `projects` row being fetched into an intermediate id/name map never reaches the client-visible output. I did not change those three functions — changing code with no provable leak, "just in case," is not what the spec asked for and would be an unjustified diff.
- **Two confirmed defects were exactly as scoped**, plus **two more found by the audit**, all fixed:
  1. `getPortalProjectOptions` / `getPortalRequests` — missing `.eq("portal_enabled", true)` on the `projects` read. Fixed in `lib/queries/portal.ts`.
  2. `client_requests_insert_own` — missing the `portal_enabled` conjunct. Fixed via new migration.
  3. `getPortalLiveNow`'s `project_phases` lookup (`:552` in the pre-fix file) — missing `.eq("client_visible", true)`. Fixed in `lib/queries/portal.ts`.
  4. **New finding, not in the spec's named list:** `client_requests_select_author_or_team`'s `created_by = auth.uid()` branch also had no `portal_enabled` check — a client could still read (not just fail to write) their own previously-filed request against a project whose portal was later disabled, via a direct PostgREST call. Fixed in the same migration as #2, same policy file, because it's the same table and the same load-bearing gate `is_project_portal_enabled` — leaving the read half open while closing the write half would still leave a client_requests row from a disabled project reachable by `SELECT`.
- **Chose RLS over a query filter for the `client_requests` fix** (scope item 5: "prefer RLS... a filter in one query is a filter someone forgets in the next one"). `getPortalRequests`'s own `.eq("portal_enabled", true)` on `projects` is kept as belt-and-braces (it also narrows the `.in("project_id", ...)` list passed to the `client_requests` query, so both layers now agree), but the actual gate is now the database policy, matching how `20260909010000` already handles `tasks`/`project_phases`.
- **Did not fold `portal_enabled` into ordinary `projects` SELECT RLS itself** (i.e. did not touch `is_project_visible_to`). This is a *repeat* of F001's own documented decision (`getPortalProjects`'s comment at `lib/queries/portal.ts:106-112`, pre-existing, unchanged by me): `is_project_visible_to` backs many non-portal client-facing policies (chat, docs — grepped `is_project_visible_to` usage across `20260904020000_chat_system.sql:139,157` and `20260905020000_docs_project_visibility_rls.sql:19` etc., confirmed by `grep -rn "is_project_visible_to" supabase/migrations/`), so narrowing it by `portal_enabled` would silently change unrelated features. This is a decision I am *repeating*, not overriding — I am not the one who made it, and nothing in this feature's clarified spec or scope asked me to revisit it.
- **`getPortalLiveNow` / `getPortalTeam`'s own `projects` fetch (workspace_id resolution) was left unchanged** — see "Out-of-scope work needed" below. This is a real gap the scrutiny report's FU-2 also names, but it is not reachable today (only caller is the already-gated `p/[projectId]/page.tsx`, verified by `grep -rn "getPortalLiveNow\|getPortalTeam" app/`), and fixing it (adding caller-membership re-verification) is a larger, different-shaped change than the five-table audit this feature scoped.
- **Left `project_statuses_select_visible` untouched.** The M1 scrutiny report's B1 names this as "related, narrower" and explicitly separate from the AS-007 blocker; `project_statuses` is not one of the five tables this feature's own Scope item 1 names (`projects, tasks, project_phases, client_requests, attachments`). Flagged below as follow-up rather than silently expanded into.

## Audit enumeration (Scope item 1 — every function in `lib/queries/portal.ts` and its gate)

| Function | Tables touched (of the audited five) | Gate before this feature | Gate after this feature |
|---|---|---|---|
| `getPortalProjects(workspaceId)` | `projects` (direct read); `tasks` (RLS only) | `projects`: explicit `.eq("portal_enabled", true)` (already correct, F001). `tasks`: RLS `tasks_select_active_members` (`client_visible AND portal_enabled` for client role). | Unchanged — already correctly gated. |
| `getProjectPhases(projectId)` | `project_phases` (direct + RLS); `tasks` (direct + RLS) | `project_phases`: explicit `.eq("client_visible", true)` + RLS `project_phases_select_client` (`client_visible AND is_project_visible_to AND is_project_portal_enabled`). `tasks`: explicit `.eq("client_visible", true)` + RLS. | Unchanged — already correctly gated at both layers. |
| `getPortalBadgeCounts(projectId)` | `tasks` (direct + RLS) | Explicit `client_visible=true` + RLS `tasks_select_active_members`. A disabled project's count silently returns `0` (RLS strips the rows) rather than erroring — not a leak, no name/id exposed. | Unchanged. |
| `getPortalLiveNow(projectId)` | `projects` (admin client, no RLS); `project_phases` (admin client, no RLS) | `projects`: no `portal_enabled`/`deleted_at` check (caller-gated only — see Out-of-scope). `project_phases`: **no `client_visible` filter — BUG, fixed.** | `project_phases`: `.eq("client_visible", true)` added. `projects`: unchanged (see Out-of-scope). |
| `getPortalTeam(projectId)` | `projects` (admin client, no RLS) | No `portal_enabled`/`deleted_at` check (caller-gated only). Does not touch `project_members`/`client_requests`/`attachments` in a leak-relevant way (`project_members` isn't one of the five audited tables). | Unchanged (see Out-of-scope). |
| `getPortalRequests(workspaceId)` | `projects` (direct read); `client_requests` (direct + RLS) | `projects`: **no `portal_enabled` filter — BUG, fixed.** `client_requests` RLS (`client_requests_select_author_or_team`): **author branch had no `portal_enabled` check — BUG, fixed.** | `projects`: `.eq("portal_enabled", true)` added. RLS: `is_project_portal_enabled` folded into the author branch. |
| `getPortalProjectOptions(workspaceId)` | `projects` (direct read) | **No `portal_enabled` filter — BUG, fixed.** | `.eq("portal_enabled", true)` added. |
| `getPortalTaskDetail(workspaceId, taskId, userId)` | `tasks` (direct + RLS); `projects` (direct, workspace-match check only) | `tasks`: RLS `tasks_select_active_members`. `projects`: read only to confirm `workspace_id` match for the URL guard, not a source of leaked rows (a task from a disabled project is already invisible via the `tasks` RLS above, so this never even runs for one). | Unchanged — safe by construction. |
| `getPortalOverview(workspaceId)` | `projects` (direct read, id/name map only); `tasks` (RLS only) | `projects`: no `portal_enabled` filter, but only feeds an id/name lookup table. `tasks`: RLS `tasks_select_active_members` is the real gate — output never includes a disabled project's task. | Unchanged — RLS-backed, no proven leak. |
| `getPortalActivitySummary(workspaceId, userId)` | `projects` (direct read, id/name map only); `tasks` (RLS only) | Same shape as `getPortalOverview`. `workspace_members.portal_last_seen_at` bookkeeping goes through the admin client but touches no project/task/phase/request/attachment row. | Unchanged — RLS-backed, no proven leak. |
| `getPortalFiles(workspaceId)` | `projects` (direct read, id/name map only); `tasks` (direct + RLS); `attachments` (direct + RLS) | `projects`: no `portal_enabled` filter, id/name map only. `tasks`: explicit `client_visible=true` + RLS. `attachments`: RLS `attachments_select_active_members` → `is_task_visible_to` (folds `portal_enabled`, `20260909010000:213-230`). | Unchanged — RLS-backed at both the task and attachment layer, no proven leak. |
| `getPortalPages(projectId)` | `projects` (direct read, workspace_id only); `tasks` (direct + RLS) | `projects`: read only to resolve `workspace_id` for the `task_types` lookup, not exposed. `tasks`: explicit `client_visible=true` + RLS. | Unchanged — safe by construction. |
| `getPortalRisks`, `getWorkspaceRoleForCurrentUser`, `getPortalCurrentUserProfile` | none of the five | N/A | N/A |

## Out-of-scope work needed

- **`getPortalLiveNow` / `getPortalTeam` are not independently correct** (M1 scrutiny report Minors + FU-2's second half): both resolve `workspace_id` via the admin client with no `portal_enabled`, `deleted_at`, or caller-membership check of their own — safe today only because the sole caller (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx:88-93`) already resolved and gated `projectId` through `getPortalProjects` one request earlier. A future caller that passes an ungated `projectId` to either function would not be independently protected. Fixing this properly means passing (or re-deriving) the caller's identity into both functions, which is a larger, differently-shaped change than this feature's five-table audit — a good next feature: "Make `getPortalLiveNow`/`getPortalTeam` verify `portal_enabled`, `deleted_at`, and caller membership internally, restoring the `status = 'active'` conjunct on the `workspace_members` role lookups both functions currently drop."
- **`project_statuses_select_visible` does not fold `portal_enabled`** (M1 scrutiny B1, "related, narrower"): `GET /rest/v1/project_statuses?project_id=eq.<disabled>` still returns every board-column name and the new `client_description` (AS-016) to a client of a portal-disabled project, via direct PostgREST. Not one of this feature's five audited tables and not one of its two confirmed defects; a follow-up should add `is_project_portal_enabled(project_id)` to that policy's client branch the same way this feature added it to `client_requests`'s two policies.
- **`is_project_portal_enabled` is executable by PUBLIC/anon** (M1 scrutiny Minor): no `revoke all ... from public` on that function, unlike `seed_default_phases` in the same migration. Low severity (UUIDs are unguessable) but cheap to close; out of scope here since it's not a `lib/queries/portal.ts` read.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Extended `tests/integration/f003-portal-shell.test.ts` (the file the spec explicitly names as the reproduction) with a new, self-contained `describe` block and its own two-project fixture, rather than editing the existing F003 fixture in place — the existing fixture is shared by four F003-authored tests I did not want to risk destabilizing, and Definition of done's "primary success test" only requires reusing *the same two-project shape*, not literally the same `beforeAll`.

AUTONOMOUS_DECISION: For the primary-success integration test's `client_requests` and `project_phases` fixture rows I inserted directly via the admin client (bypassing RLS) rather than through the client session, since the whole point of two of those rows (a request already filed against a since-disabled project, and a phase that would be client-visible on an enabled project) is a past/hypothetical state the client could not have produced themselves after this fix — inserting via `clientSession` would just re-prove the write-side policy test that already exists as its own assertion.

## Notes for the next worker

- The migration file is `supabase/migrations/20260913010000_client_requests_portal_enabled_gate.sql` — applied via `npm run db:apply` against the live linked Supabase project (not the Supabase MCP; per the task instructions the MCP was not authorised for this feature, and `mcp-registry.md` was consulted but the CLI/`npm run db:apply` path is what `tech-decisions.md` and every prior migration-authoring feature in this mission uses).
- `npm run db:gen-types` was run after applying the migration; it produced no diff in `lib/supabase/database.types.ts` because this migration only replaces policies, adding no columns/tables.
- If a future worker touches `client_requests` RLS again, both policies now read `and public.is_project_portal_enabled(project_id)` — keep that conjunct inside the *client-only* branch of any policy that also has a team branch, exactly as `tasks_select_active_members` and the two policies this migration changes all do, so team access is never affected.
