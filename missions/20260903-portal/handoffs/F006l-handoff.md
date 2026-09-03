# Handoff: F006l — The paths that never reach RLS

## Status
COMPLETE

## Assertions covered
AS-007: PASS — a client of a portal-disabled project is rejected by all four named paths (decide_approval_atomic, get_open_task_counts, addComment, getAttachmentSignedUrl), each called directly against the real linked Supabase project, and each still works correctly on an enabled project / for a team caller.

## Files changed
- supabase/migrations/20260920010000_f006l_bypass_paths.sql (new — B1 decide_approval_atomic gate, B2 get_open_task_counts rewrite)
- supabase/migrations/20260920020000_f006l_open_task_counts_client_branch_fix.sql (new — corrects B2's client-branch predicate; see Decisions made)
- lib/actions/comments.ts (B3 — explicit portal_enabled check for the client branch of addComment)
- lib/actions/attachments.ts (B4 — explicit portal_enabled check for the client branch of getAttachmentSignedUrl)
- tests/integration/f007-approvals-rls.test.ts (new test: AS-007/B1 direct RPC call on a portal-disabled project)
- tests/integration/f006l-open-task-counts-rpc.test.ts (new file: AS-007/B2)
- tests/integration/f006l-portal-admin-client-bypass.test.ts (new file: AS-007/B3, B4)

## Commands run
`npm run db:apply -- supabase/migrations/20260920010000_f006l_bypass_paths.sql` (0)
`npm run db:apply -- supabase/migrations/20260920020000_f006l_open_task_counts_client_branch_fix.sql` (0)
`npx vitest run tests/integration/f007-approvals-rls.test.ts` (0, 30 passed)
`npx vitest run tests/integration/f006l-open-task-counts-rpc.test.ts` (0, 4 passed)
`npx vitest run tests/integration/f006l-portal-admin-client-bypass.test.ts` (0, 4 passed)
`npx vitest run tests/integration/add-comment.test.ts tests/integration/f323-sibling-action-project-visibility.test.ts` (0, 43 passed — regression check on the two files I edited)
`npx vitest run tests/unit/comment-mentions.test.ts tests/unit/portal-approval-action.test.ts tests/unit/notification-fanout.test.ts` (0, 47 passed)
`npx tsc --noEmit` (0, clean)
`npx eslint lib/actions/comments.ts lib/actions/attachments.ts tests/integration/f006l-portal-admin-client-bypass.test.ts tests/integration/f006l-open-task-counts-rpc.test.ts tests/integration/f007-approvals-rls.test.ts` (0, clean)
`npm run migrations:check` (0, "No migration drift — all migrations present on remote.")

Full vitest suite was **not** run, per this feature's instruction (another worker is active; only ran the tests relevant to this change plus typecheck/lint).

## Decisions made

- **B1 (decide_approval_atomic):** added `is_project_portal_enabled(v_project_id)` as its own check, raising the identical `42501`/"you are not the decision owner" message the real decision-owner check uses immediately below it — the caller cannot distinguish "portal off" from "not the decision owner", matching the oracle-neutral shape F006i used for `assert_portal_task_actionable_by_client`.

- **B2 (get_open_task_counts):** rewrote from a bare `language sql` one-liner with **no auth check and no revoke** into a `plpgsql` function that (a) returns nothing for an unauthenticated caller, (b) requires `is_active_workspace_member`, and (c) branches on caller role: a client caller must have `is_project_portal_enabled` true and only counts `client_visible` tasks; a non-client caller uses the ordinary `is_project_visible_to` predicate. Added `revoke ... from public` (the original had none, so EXECUTE defaulted to PUBLIC including `anon`).

  **Two-migration note:** my first attempt at B2 gated the *entire* query on `is_project_visible_to`, which deliberately excludes the `client` role by design (`20260908010000`/`20260902010000` — verified by reading those two files, not assumed). That made the RPC return zero rows for a client of a portal-**enabled** project too, which the integration test caught immediately (a real failure, not a hypothetical — see the "AS-007/AS-054 ... portal-ENABLED project" test in `tests/integration/f006l-open-task-counts-rpc.test.ts`, which failed against the first version). Fixed by splitting the predicate into a client branch (`is_project_client` + `is_project_portal_enabled` + `client_visible`) and a non-client branch (`is_project_visible_to`), the same shape `project_phases_select_client` vs `project_phases_select_team` uses in RLS (`20260909010000`). Because `npm run db:apply` records migrations in a ledger keyed by filename and will not re-run an already-applied one, the fix required a second migration file (`20260920020000`) to actually reach the remote database; `20260920010000`'s own source was edited in place to match, so a fresh environment applying from scratch only ever sees the corrected body.

- **B3 (addComment):** added `projects.portal_enabled` to the existing task/project lookup query (already selecting `visibility`) and added one explicit check beside the existing `client_visible` check, returning the identical "Task not found." message (same oracle-neutral convention every other check in this function already uses).

- **B4 (getAttachmentSignedUrl):** same shape as B3 — added `portal_enabled` to the existing `projects(...)` select and one explicit check beside the existing `client_visible` check, returning "Attachment not found."

- Reused `is_project_portal_enabled` (existing, `20260909010000`) everywhere rather than inlining `select portal_enabled from projects where id = ...` a fifth time, per this feature's own scope instruction — verified there was no other inlined copy to consolidate (`grep -rn "portal_enabled" lib/actions/ lib/queries/` before starting; the only inlined `.eq("portal_enabled", true)` occurrences are read-path project-list filters in `lib/queries/portal.ts`, a different shape already covered by F006b/F006i, not touched here).

- Chose non-colliding migration timestamps `20260920010000`/`20260920020000` (the last existing migration at start was `20260919010000`) since another worker is active in this repo per the task's own instruction.

## Out-of-scope work needed

**The class sweep (required by this feature's own scope, item 2).** Enumerated every `SECURITY DEFINER` function granted to `authenticated` (`grep -rn "grant execute.*to authenticated" supabase/migrations/*.sql`, cross-referenced against the full `security definer` function list) and every `ctx.admin`/admin-client-touching Server Action reachable from `lib/actions/comments.ts` and `lib/actions/attachments.ts`'s neighbourhood. One row per function:

| Function | Grant | Internal authorisation | Reachable by a client of a portal-disabled project? | Verdict |
|---|---|---|---|---|
| `decide_approval_atomic` | authenticated | decision-owner lookup only (pre-fix) | Yes — settle an approval, clear `pending_client_approval` | **Fixed this feature (B1)** |
| `get_open_task_counts` | PUBLIC (no revoke, pre-fix) | none at all | Yes — any authenticated caller, any project id, no membership check | **Fixed this feature (B2)** |
| `addComment` (Server Action, admin client) | n/a | membership, `client_visible`, project visibility — no portal check (pre-fix) | Yes — write a comment | **Fixed this feature (B3)** |
| `getAttachmentSignedUrl` (Server Action, admin client) | n/a | membership, `client_visible`, project visibility — no portal check (pre-fix) | Yes — mint a working download URL | **Fixed this feature (B4)** |
| `assert_portal_task_actionable_by_client` (backs `approve_portal_task_atomic`, `request_portal_task_changes_atomic`) | internal only, no direct grant | workspace client membership, `is_project_visible_to`, `is_project_portal_enabled`, `client_visible`, `pending_client_approval` | No — gated by F006i (`20260918010000`), verified by reading the current body | Already fixed (prior feature) |
| `seed_default_phases` | authenticated | role check (F006d) + `is_project_visible_to` (F006i) | No (team-only action; `is_project_visible_to` excludes `client`/`guest` from the workspace branch) | Fine — team-only, no client path |
| `bulk_delete_tasks_atomic` | authenticated | **none at all** — no `auth.uid()` check, no membership, no visibility | **Yes** — any authenticated caller (team or client) can soft-delete arbitrary task ids in ANY project, portal on or off | **NOT FIXED — broader than portal_enabled, see below** |
| `duplicate_task_atomic` | authenticated | **none at all** | **Yes**, same shape | **NOT FIXED — see below** |
| `restore_task_atomic` | authenticated | **none at all** | **Yes**, same shape | **NOT FIXED — see below** |
| `set_task_assignees_atomic` | authenticated | **none at all** | **Yes**, same shape | **NOT FIXED — see below** |
| `accept_client_request_atomic` | authenticated | `auth.uid()` not null + request row lock only — no membership/triage-permission check | **Yes** — any authenticated caller with a `client_requests` id can accept it and insert a task into that project | **NOT FIXED — see below** |
| `apply_status_template` | authenticated | re-checks caller's own role is `owner`/`admin` inside the function body | No — team-only, self-contained role recheck | Fine |
| `start_timer_atomic` / `stop_timer_atomic` | authenticated | `auth.uid()` not null + active-workspace-membership check (`20260818181000`) | No — membership-gated; a non-member gets rejected regardless of portal state (these operate on the caller's own timer, not client-portal data) | Fine |
| `create_channel_atomic` | authenticated | verified (Q2 item 4 of M1-scrutiny-3) — auth branch skipped only for the admin-client caller, which already passes `p_created_by` | No — chat channels are not project/portal-scoped data | Fine |
| `create_workspace_with_owner`, `transfer_workspace_ownership`, `remove_workspace_member`, `change_workspace_slug_atomic` | authenticated | workspace-role checks internal to each function (not individually re-audited line-by-line here — workspace-level, not project/portal-scoped) | No — none accept a project or task id | Out of this feature's scope (not portal-shaped) |
| `write_task_activity_entry` | authenticated, service_role | `auth.uid()` not null (unless `p_system`, which requires a null `auth.uid()`) + "caller cannot see this task" check that reaches `is_task_visible_to`, which folds in `is_project_portal_enabled` (confirmed in M1-scrutiny-3 Q3's own RLS enumeration) | No | Fine |
| `create_notification`, `write_audit_log_entry` | authenticated (+ service_role) | hardened in three prior rounds per their own migration headers (F320 task/workspace-mismatch rejection, `create_notification` system-bypass fix); writes only, no read-back of portal data to an arbitrary caller | Not portal-specific; not re-audited line-by-line this feature (out of scope — these don't accept a project id and don't disclose row content back to the caller) | Not re-audited |
| `is_active_workspace_member`, `is_project_visible_to`, `is_project_visible_to_row`, `is_project_workspace_admin`, `is_project_workspace_member`, `is_project_workspace_writer`, `is_task_visible_to`, `is_task_workspace_member`, `is_task_workspace_writer`, `is_workspace_admin`, `is_project_lead_or_workspace_admin`, `shares_workspace_with`, `can_modify_comment`, `can_read_workspace_docs`, `can_write_workspace_docs` | authenticated | boolean predicates only — leak at most "is this true", never row content | N/A — no project/task data returned | Fine (helper predicates, not data RPCs) |
| `get_priority_counts`, `get_status_counts`, `get_overdue_count`, `get_due_soon_count`, `get_completed_count`, `get_blocked_count`, `get_project_time_totals`, `get_workspace_time_by_person`, `get_project_board_tasks` | authenticated (+ anon on several) | **`security invoker`**, not `security definer` — each reads through `active_project_tasks`, a `security_invoker = true` view, so the caller's own RLS on `tasks`/`projects` applies exactly as if queried directly | No more than a direct `tasks` SELECT would allow — RLS (portal-gated for the `client` role via `is_task_visible_to`) is the real boundary here | Fine — verified `security invoker` in each definition, not assumed from the name |

**Why `bulk_delete_tasks_atomic` / `duplicate_task_atomic` / `restore_task_atomic` / `set_task_assignees_atomic` / `accept_client_request_atomic` were found but not fixed in this feature:** these five have **no authorisation check of any kind** in their function bodies — not just a missing `portal_enabled` check, but no membership check, no visibility check, nothing beyond (for the first four) not even `auth.uid() is not null`. Any authenticated user in the entire system — a client of an unrelated workspace, a `viewer`, anyone — can call these directly and mutate tasks in a project they have never heard of. This is strictly broader than AS-007's scope (which is specifically about `portal_enabled`); fixing four more RPCs with a proper membership+role+visibility gate each is real, separate work this feature's "fix the four" + "sweep and report" scope does not cover, and attempting it under this feature's time budget risked shipping under-tested changes to team-facing bulk operations. Filed as `SUGGESTED FOLLOWUP` below.

**Verified by grep, not by memory, per this mission's standing instruction:**
- `grep -rn "grant execute.*to authenticated" supabase/migrations/*.sql` — the full list this table is built from.
- `grep -n "auth.uid\|is_active_workspace_member\|is_project_workspace_writer\|raise exception\|role" supabase/migrations/20260905060000_duplicate_task_atomic.sql supabase/migrations/20260905080000_restore_task_atomic.sql supabase/migrations/20260905050000_set_task_assignees_atomic.sql` — zero hits in all three, confirming no checks exist.
- `supabase/migrations/20260905070000_bulk_delete_tasks_atomic.sql:5-44` read in full — no `auth.uid()`, no membership predicate anywhere in the body.
- `supabase/migrations/20260905100000_accept_client_request_atomic.sql:27-79` read in full — only `auth.uid() is not null` and row-existence/state checks.
- `security invoker` confirmed by grep in each of the nine `get_*`/dashboard RPCs' defining migrations, not assumed.

**SUGGESTED FOLLOWUP (new feature, not portal-specific — broader authz hole in the same SECURITY DEFINER class):** Add a membership + role (+ project-visibility where applicable) check to `bulk_delete_tasks_atomic` (`20260905070000`), `duplicate_task_atomic` (`20260905060000`), `restore_task_atomic` (`20260905080000`), and `set_task_assignees_atomic` (`20260905050000`) — each currently has zero internal authorisation and relies entirely on its calling Server Action's compensating checks, which a direct RPC call bypasses. Add a triage-permission + workspace-membership check to `accept_client_request_atomic` (`20260905100000`) — currently any authenticated user can accept any `client_requests` row by id. Definition of done: a test per RPC that calls it directly as (a) an outsider with no workspace membership at all and (b) a `viewer`/`client` role without write permission, asserting rejection, plus a regression test that the legitimate Server Action flow still works. Consider the general enumeration rule M1-scrutiny-3 recommended: a test over `pg_proc` that every `SECURITY DEFINER` function granted to `authenticated` accepting a project/task id references at least one of `is_project_visible_to`, `is_project_portal_enabled`, or an explicit membership check — this sweep's table is the human-readable version of that rule; the automated version would catch the next one before an M1-style scrutiny has to.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Left `project_statuses_select_visible` and `task_types_select_active_members` (M1-scrutiny-3's B5, "medium" severity) untouched — they are RLS-layer gaps, not bypass-the-RLS gaps, so they are the opposite of this feature's scope ("the paths that never reach RLS"). They were already filed as a separate recommended follow-up (FD) by the scrutiny round that opened this feature; not duplicating that filing here.

AUTONOMOUS_DECISION: Did not touch the AS-002 badge-count bug (M1-scrutiny-3's own top finding) or FB/FC/FE from that same review — all explicitly out of this feature's four-paths-plus-sweep scope, and FB is explicitly sanctioned to land with M2's F008/F009 by the scrutiny doc itself.

## Notes for the next worker

- The `f007-approvals-rls.test.ts` fixture (`disabledProjectId`, `disabledProjectRequestId`, `disabledProjectVisibleTaskId`, decision-owner `clientSession`) already existed and was built exactly for this kind of test — I added `pending_client_approval: true` to its task insert so the new B1 test could assert the flag is untouched by the rejected RPC call; this is a from-scratch state change to an existing fixture, not a new one, so double-check it if that file conflicts with the other active worker's changes.
- Both new migration files (`20260920010000`, `20260920020000`) are additive `create or replace function` — no `DROP`, no signature change, so `db:gen-types` was not re-run (return types and parameter types of `decide_approval_atomic` and `get_open_task_counts` are unchanged from before this feature).
- No MCP was used for this feature — Supabase MCP is not authorised for this mission per the task instructions; migrations were applied via `npm run db:apply` (the repo's own CLI-based script, not raw `psql`) and verified via `npm run migrations:check`.
