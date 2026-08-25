# Handoff: F270 — type-check and lint clean

## Status
COMPLETE

## Assertions covered
AS-527: PASS — `npx tsc --noEmit` exits 0 (no output, no errors). No new `any` introduced anywhere (no code changes were needed/made).
AS-528: PASS — `npx eslint .` reports "0 problems (0 errors, 6 warnings)". The 6 warnings are pre-existing, unrelated to this feature (`lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`, `tests/unit/palette-actions-recents.test.tsx` — 4 unused-var warnings there), and are not lint errors.

## Files changed
(none — repo was already compliant for Part 1; Part 2's drop migration was deliberately NOT written — see Decisions made / Out-of-scope)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings)
`npx vitest run tests/unit` (0) — 167 files / 1305 tests passed. One `Errors 1` line in the summary is an unhandled-rejection log from an async effect in `user-avatar.test.tsx` (via `comment-list.tsx` → `getMentionCandidates` → `cookies()` outside request scope), not a failed test — 1305/1305 tests still pass, this is pre-existing test-harness noise unrelated to this feature and out of scope to touch.
`npx next build` (0) — compiled successfully, TypeScript check inside build passed, all routes generated.

## Decisions made

**Part 1 (tsc/eslint):** Verified the repo was already at the baseline claimed by every prior feature this session (0 tsc errors, 0 eslint errors, 6 known warnings — NEXT-SESSION.md said 2 warnings but a live count today shows 6, all in the same pre-existing category of intentionally-unused-but-documented variables prefixed `_`; none are new, none relate to this feature's scope, none are errors). No fixes were needed. This is the "already compliant" outcome explicitly allowed by the clarification's Q6 (Empty/zero state: "say so explicitly in the handoff — 'already compliant' is a valid, documented outcome").

**Part 2 (deprecated column drops): NOT performed. This is a deliberate, spec-conformant outcome, not a shortfall.**

Per the clarification's explicit instruction ("The drop migration must be last and must be preceded by a grep proving no reader remains") and the task's hard STOP rule ("If you are not fully confident after grepping ... STOP and report ... A conservative 'did not drop anything, here's why' is a completely acceptable outcome"), I ran an exhaustive repo-wide grep for `tasks.status`/`.status` on tasks, `tasks.assignee_id`/`.assignee_id`, and `tasks.description`/`.description` across `app/`, `lib/`, `components/`, `tests/`, and `supabase/migrations/`. All three columns have extensive, unambiguous LIVE readers/writers in current application code. Full enumeration below. None of the three columns qualifies for dropping. No migration was written; `database.types.ts` was not touched; the real Supabase schema was not queried/modified because there was nothing safe to sync it to.

### Full grep enumeration and reasoning

**1. `tasks.status` (text column)**

Grep: `grep -rn "tasks\.status\b" app lib components tests supabase/migrations` plus `grep -rn "\.select([^)]*\bstatus\b[^)]*)\|\.eq(\"status\"" lib app components`.

- Comment/doc-only matches (no live read): `lib/queries/search.ts:88`, `lib/queries/calendar.ts:150` (comment describing behavior, not the code line itself), test-file comments in `tests/unit/blocked-guard.test.ts`, `tests/integration/tasks-schema.test.ts`, `tests/integration/f325-status-rename-sync.test.ts`, `tests/integration/f219-status-management.test.ts`, `tests/integration/f223-status-integration-list-search-dashboard.test.ts`, and every migration-file comment (`20260824010000_project_statuses.sql`, `20260825010000_status_counts_custom_columns.sql`, `20260824040000_status_delete_reassign_rpc.sql`, `20260824020000_project_statuses_management.sql`, `20260828030000_status_rename_sync_and_seed_colors.sql`) — these are historical/explanatory prose, not readers.
- **Live readers/writers found (column is NOT dead):**
  - `lib/queries/calendar.ts:198` — `query = query.eq("status", filters.status);` — direct filter against `tasks.status` in the live calendar query.
  - `lib/queries/tasks.ts:310` and `:430` — `query = query.eq("status", filters.status);` — direct filter against `tasks.status` in the live board/list task queries, and both queries also `.select(...status...)` at lines 304/423 including the raw `status` column alongside `status_id`.
  - `lib/tasks/create.ts:263` (`.eq("status", parsed.data.status)`) and `:289` (`.select("id, project_id, title, description, status, priority, assignee_id, ...")`) — task creation reads and selects `status` directly.
  - `lib/actions/tasks.ts` — many direct reads/writes: `:281` `.eq("status", "active")` (different table, project_members — excluded, see below), `:1730` `.eq("status", resolvedStatus)`, `:1747` `.select("id, project_id, status, position")`, `:1804` `.select("id, status")`, `:1820` `.eq("status", childResolvedStatus)`, `:2377` `.select("id, status")`, `:2868` `.select("id, status, position")`, `:3260`/`:3328` select including `status`, `:4259` `.eq("status", targetStatus)`, `:4291` `.select(..., status, ...)`, `:4643`/`:4655` `.select("id, status, assignee_id, ...")` — all against the `tasks` table.
  - `lib/actions/templates.ts:389` `.eq("status", targetStatus)` and `:457` `.select("id, project_id, title, status, position, number")` — against `tasks` (template application writes a task's `status`).
  - The DB trigger `sync_task_status_and_status_id` (`supabase/migrations/20260824010000_project_statuses.sql`) explicitly derives `status_id` FROM `status` on every write where `status` changes — an active trigger, i.e. a live reader at the database level.
  - Excluded as false positives (different table, same column name): `lib/comments/mentions.ts:175`, `lib/queries/workspaces.ts:25`, `lib/auth/require-membership.ts:37`, `lib/queries/project-members.ts:94,159`, `lib/actions/comments.ts:1422`, `lib/actions/workspaces.ts` (multiple — `workspace_members.status`), `lib/actions/invites.ts:53`, `lib/actions/project-members.ts:77,189`, `lib/actions/dependencies.ts:570` (task `status` select for display, also a live tasks reader — included above via the same file), `app/(workspace)/w/[workspaceSlug]/layout.tsx:180` (`workspace_members.status`).
  - Conclusion: `tasks.status` is read and written directly by numerous Server Actions and queries today. **NOT dead. Not dropped.**

**2. `tasks.assignee_id`**

Grep: `grep -rn "tasks\.assignee_id\|assignee_id" app lib components tests supabase/migrations`.

- Comment-only matches: `lib/tasks/reconcile-list-realtime-task.ts:7,20` (comments), `lib/activity/task-activity.ts` comments, `lib/activity/format-task-activity-entry.ts` comments, `lib/queries/my-tasks.ts:8,19` comments, `lib/queries/tasks.ts:99,116,216,316,335,336` comments, `lib/actions/tasks.ts:207,324,344,347,644,651,655,694,695,3413,4501` comments, `components/task/new-task-dialog.tsx:207`, `components/task/list-filters.tsx:72` (JSDoc), and every migration-file historical comment.
- **Live readers/writers found (column is NOT dead — it is an intentionally-maintained mirror, per F159/F160's design as documented in the migration comments):**
  - `lib/actions/tasks.ts:360` — `await admin.from("tasks").update({ assignee_id: mirror }).eq("id", taskId);` — the mirror-write path is live application code, executed on every assignee change.
  - `lib/actions/tasks.ts:551,559,4619,4627,4643,4655,4679,4685,4764,4766` — direct selects/updates of `assignee_id` on `tasks`.
  - `lib/queries/tasks.ts:141,174,304,356,423,469` — selects `assignee_id` directly in the live board/list/my-tasks queries and maps it to `assigneeId` in the returned shape consumed by the UI.
  - `lib/tasks/create.ts:282,289,397` — writes `assignee_id` on task creation and returns it.
  - `lib/tasks/reconcile-list-realtime-task.ts:70,97`, `lib/board/reconcile-realtime-task.ts:43,63`, `lib/board/subscribe-board-realtime.ts:26` — realtime payload shapes and reconciliation logic read `assignee_id` off live Postgres change events.
  - `lib/actions/templates.ts:504` — `.update({ assignee_id: resolvedAssigneeIds[0] ?? null })` — template application writes `assignee_id`.
  - `lib/supabase/database.types.ts` — generated types include `assignee_id` on the `tasks` row/insert/update shapes and on the board RPC return types; these are consumed throughout the app's TypeScript.
  - Excluded: test files (`tests/unit/*`, `tests/integration/*`) exercise the same live mirror behaviour — they are proof of live behaviour, not independent readers, but confirm the column is actively tested as a real, maintained feature (e.g. `tests/integration/task-assignees-multi.test.ts:329` — "setTaskAssignees keeps tasks.assignee_id (the deprecated mirror column) in sync with the first assignee").
  - Conclusion: `tasks.assignee_id` is a deliberately-maintained single-value mirror of the new `task_assignees` join table (per F159/F160's explicit design), still read by the board/list/realtime/notification code paths named in the migration's own comment (`lib/actions/tasks.ts:324`: "`tasks.assignee_id` (board grouping, my-tasks, notifications) for a task"). **NOT dead. Not dropped.** Dropping it today would break every one of those live call sites and is a substantially larger migration than "drop a dead column" — it would require first migrating every reader listed above onto `task_assignees`/`assignee_ids`, which is out of this feature's scope.

**3. `tasks.description`**

Grep: `grep -rn "tasks\.description" app lib components tests supabase/migrations` plus targeted checks in `lib/tasks/create.ts` and `lib/actions/tasks.ts`.

- Comment-only matches: `components/task/task-detail-sheet.tsx:235`, migration-file comments in `20260822090000_task_description_json.sql`, `20260822130000_task_description_json_direct_write.sql`, `20260822100000_comment_body_json.sql`.
- **Live readers/writers found (column is NOT dead — it is the source-of-truth text column that a DB trigger derives `description_json`/`description_text` FROM):**
  - `lib/tasks/create.ts:90,279,289,394` — writes `description` on task creation (`input.description`/`parsed.data.description`), selects it back (`"id, project_id, title, description, status, ..."`), and returns it.
  - `lib/actions/tasks.ts:69,850,1082,1301,2466,3704,4234,4278` — `description` appears in read/update type shapes, is checked for presence (`if ("description" in parsed.data.updates)`), and is read/returned at multiple points (task detail, clone, template creation).
  - The DB trigger from `20260822090000_task_description_json.sql`/`20260822130000_task_description_json_direct_write.sql` derives `description_json`/`description_text` FROM `new.description` on the (still live, unmigrated-away) write path where only `description` is set — i.e. `description` remains the column of record whenever the app doesn't specifically use the newer `description_json` direct-write path (F173's inline checkbox toggle is the only caller that bypasses it). The trigger's own header confirms: "`description` itself is never derived FROM description_json here" and flags full reversal as "a separate feature" — i.e. explicitly NOT this one.
  - Conclusion: `tasks.description` is still the write path used by task creation, cloning, and template application, and the DB trigger still derives the JSON/text projections from it. **NOT dead. Not dropped.**

### Summary
All three columns named in the spec have current, unambiguous live readers in application code and/or active database triggers. Per the spec's own conservative-default instruction, none were dropped. No migration file was created. `database.types.ts` was not regenerated because no schema change occurred. Supabase MCP/CLI schema introspection was not needed since the repo-side grep alone was already conclusive and matched the schema comments' own description of current state.

## Out-of-scope work needed

Fully migrating off these three deprecated columns is a substantially larger effort than this feature's scope, and should be split into dedicated follow-up features per column, each ending in its own drop migration once its own grep is clean:

- **`tasks.status` retirement**: migrate `lib/queries/calendar.ts`, `lib/queries/tasks.ts` (board/list queries), `lib/tasks/create.ts`, `lib/actions/tasks.ts`, and `lib/actions/templates.ts` to read/write only `status_id` (joining `project_statuses` for display name), retire the `sync_task_status_and_status_id` trigger, then grep-prove and drop `tasks.status`.
- **`tasks.assignee_id` retirement**: migrate the board/list/my-tasks/notification/realtime read paths and the `lib/actions/tasks.ts` mirror-write (`:360`) fully onto `task_assignees`, remove the mirror-write trigger/logic, then grep-prove and drop `tasks.assignee_id`. This is the largest of the three — it touches realtime payload shapes and the generated `database.types.ts` RPC return types.
- **`tasks.description` retirement**: migrate task creation/clone/template-apply (`lib/tasks/create.ts`, `lib/actions/tasks.ts`) to write only `description_json` (with `description_text` derived from it, reversing today's trigger direction — the migration's own header flags this reversal as a separate, deliberate feature), then grep-prove and drop `tasks.description`.

None of these were started; this feature only performed the audit and conservatively declined to touch schema, per spec.

## Blockers
(none — Status is COMPLETE; Part 2 was correctly resolved to "no safe drop found," which is an explicitly valid outcome, not a blocker)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "already compliant" (Part 1) and "conservative — did not drop anything" (Part 2) as fully valid COMPLETE outcomes for an audit-archetype feature, per the clarification's Q6/Q7 answers and the task instructions' explicit "A conservative... is a completely acceptable outcome" line. Did not mark BLOCKED/PARTIAL since nothing was actually blocking a required change — the audit correctly concluded no destructive action should be taken.

## Notes for the next worker
- Baseline confirmed live at handoff time: `npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors / 6 pre-existing warnings; `npx vitest run tests/unit` 167 files / 1305 tests green; `npx next build` succeeds.
- Any future worker attempting the column drops from "Out-of-scope work needed" above must re-run the same grep methodology fresh (code will have changed) — do not assume this handoff's enumeration is still accurate by the time that follow-up work starts.
- No MCP tools were invoked this session — the repo-side static grep was conclusive on its own, and per the registry "Never block a feature on MCP approval" plus the spec's own "final sanity check" step only applies once you're actually about to drop a column, which did not happen here.
