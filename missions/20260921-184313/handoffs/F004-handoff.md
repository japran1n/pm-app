# Handoff: F004 — getMyProjectsProgress

## Status
COMPLETE

## Assertions covered
AS-050: PASS — `getMyProjectsProgress` returns `doneCount`/`totalCount` derived from the project's tasks, resolved through `project_statuses.category` (not literal status text), for the progress-bar UI. Unit test `AS_050_returns_done_and_total_counts_for_progress_bar`.
AS-051: PASS — `overdueCount` counts only non-done tasks whose `due_date` is strictly before today; a done task with a past due date and a not-yet-due task are both excluded. Unit test `AS_051_counts_only_non_done_tasks_past_due_as_overdue`.
AS-052: PASS — only projects where the given `userId` has a `project_members` row are returned; other users' memberships, other workspaces, and archived (soft-deleted) projects are excluded. Unit test `AS_052_only_returns_projects_where_the_user_is_a_member`.

## Files changed
lib/queries/projects.ts
tests/unit/my-projects-progress.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/my-projects-progress.test.ts` (0, 5/5 passed)
`npx vitest run` (0 exit, but this shared working tree currently has ~647 pre-existing failing test files, all under `.claude/worktrees/...` from unrelated concurrent agent worktrees — none in `lib/`, `tests/unit/my-projects-progress.test.ts`, or anything touched by this feature)

## Decisions made
- Reused `buildStatusBucketMaps` (lib/portal/status-bucket.ts) for status_id → category resolution instead of writing a third copy of the same "status_id, falling back to project_id:name" lookup that `getPortalProjects` and `getProjectHealthInputs` already implement independently — same category-not-literal-status-text correctness the spec's "done-category status" wording requires (F218+ custom columns).
- `overdueCount`: date-only string comparison (`task.due_date < todayIso`), same convention `getPortalProjects` uses, since the clarified spec gave no caller-supplied timezone (unlike the RPC-based dashboard tiles in lib/queries/dashboard.ts, which do take one). Strictly-before-today, so a task due today is not counted as overdue.
- Project membership join uses `project_members.select("project_id, projects!inner(...)")` with `.eq("projects.workspace_id", ...)` and `.is("projects.deleted_at", null)` — filters on the embedded resource, consistent with Supabase PostgREST embedded-filter syntax, so both workspace scoping and soft-delete exclusion happen in the same query as the membership check (no second round trip).
- Sort: `overdueCount` desc, then `projectName` asc, per spec step 4 — implemented as a JS `.sort()` after both counts are computed rather than in SQL, since counts already require in-memory aggregation over two batched queries.

## Out-of-scope work needed
`nextMilestoneName`/`nextMilestoneDate` are part of the `MyProjectProgress` type (per the clarified spec's own type definition) but the spec's "Logic" section never describes how to derive a milestone — no `project_phases`/milestone table read is specified anywhere in the clarified implementation. AUTONOMOUS_DECISION: kept both fields in the exported type exactly as clarified, but always return `null` for both, since no assertion (AS-050/051/052) exercises them and guessing a milestone source (e.g. next `project_phases` row by `planned_start`) risked contradicting a future, more specific spec. If a future feature/assertion needs a real "next milestone" on this card, a follow-up should specify which table (likely `project_phases`, already used by `getProjectHealthInputs` for `currentPhase` in this same file) and which ordering (planned_start ascending, `state != done`?) defines "next".

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: `nextMilestoneName`/`nextMilestoneDate` always return `null` — see "Out-of-scope work needed" above for rationale and a concrete follow-up spec.
AUTONOMOUS_DECISION: `projectKey` falls back to `""` (empty string) if a project's `key` column is ever null — matches the type's non-nullable `string` (unlike `ProjectListItem.key` elsewhere in this file, which is `string | null`); in practice `key` is backfilled by a BEFORE INSERT trigger for every project (see this file's existing `ProjectListItem.key` comment), so this path is defensive only.

## Notes for the next worker
- This repo's working tree appears to be shared across concurrently-running mission workers on the same `main` branch (not isolated per-worker worktrees) — while implementing this feature, an unrelated commit (`2fb13857`, "feat(templates): import Team Website 2.0 template from ClickUp") from a different concurrent session ended up bundling my in-progress edit to `lib/queries/projects.ts` (140 lines, exactly the `getMyProjectsProgress` addition) under its own unrelated commit message. The code itself is correct and present at HEAD; only the commit attribution/message is misleading. I did not amend or rewrite that commit (out of scope, and amending other agents' commits is risky in a shared tree). Only `tests/unit/my-projects-progress.test.ts` ended up in my own commit (`5b56ae9c`, `feat(F004): add getMyProjectsProgress query`) since `lib/queries/projects.ts` had no remaining diff to stage by the time I ran `git add`.
- No MCP tools were used for this feature — pure query-layer logic against existing tables (`project_members`, `projects`, `tasks`, `project_statuses`), no live schema/policy verification needed beyond the existing `database.types.ts` column names already confirmed by reading that file.
