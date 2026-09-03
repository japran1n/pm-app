# Handoff: F013 — Team UI: client obligations

## Status
COMPLETE

## Assertions covered
AS-028: PASS — a project can hold a list of items the client owes (`client_deliverables`, F012); this feature adds the team management surface (`components/project/deliverables-panel.tsx` + `lib/actions/deliverables.ts` CRUD/reorder actions) and extends the `kind='project'` template payload with a `deliverables[]` section so the list can be seeded per template. Covered by `tests/unit/f013-project-template-deliverables-payload.test.ts` (4 tests) and `tests/integration/project-from-template.test.ts`'s two new AS-028 tests (seed + legacy-template-no-key-still-works).
AS-030: PASS — `delivered` is not `accepted`; only `accepted`/`waived` stop a deliverable counting against the project. Enforced by `sweep_overdue_blocking_deliverables` (only moves a task INTO its project's `client_bucket = 'blocked'` column, never out, and is idempotent per task) and `accept_deliverable_atomic` (a `returned` decision goes back to `in_progress`, not `delivered` — the client must re-deliver). Covered by `tests/integration/f013-deliverables-review-and-sweep.test.ts`'s AS-030 describe blocks (5 tests: blocks, idempotent-twice, accepted-deliverable-no-longer-blocks, non-blocking-deliverable-never-blocks, direct-call smoke test).
AS-032: PASS — a team member accepts a deliverable or returns it with a required comment, and the client sees which happened (via `state`/`review_note` on `client_deliverables`, readable through F012's existing client SELECT policy). Covered by `tests/integration/f013-deliverables-review-and-sweep.test.ts`'s AS-032 describe blocks (5 tests: accept, return-with-note, empty-note-rejected, viewer-rejected, client-rejected).

## Files changed
supabase/migrations/20260927010000_f013_deliverables_review_and_blocking_sweep.sql
supabase/migrations/20260927020000_f013_project_template_deliverables.sql
lib/validation/deliverables.ts
lib/actions/deliverables.ts
lib/validation/templates.ts
lib/actions/templates.ts
components/project/deliverables-panel.tsx
components/project/project-settings-nav.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/deliverables/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/deliverables/error.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/deliverables/loading.tsx
lib/supabase/database.types.ts
tests/integration/f013-deliverables-review-and-sweep.test.ts
tests/integration/project-from-template.test.ts
tests/unit/f013-project-template-deliverables-payload.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260927010000_f013_deliverables_review_and_blocking_sweep.sql` (0)
`npm run db:apply -- supabase/migrations/20260927020000_f013_project_template_deliverables.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/unit/f013-project-template-deliverables-payload.test.ts` (0, 4 passed)
`npx vitest run tests/integration/f013-deliverables-review-and-sweep.test.ts` (0, 10 passed)
`npx vitest run tests/integration/project-from-template.test.ts` (1 pre-existing unrelated failure — see Decisions made; 13 passed including this feature's 2 new AS-028 tests)

## Decisions made
- `accept_deliverable_atomic` writes its audit trail via the existing `write_audit_log_entry` RPC (`audit_log`, workspace-scoped, owner/admin-only reading) — mirrors `decide_approval_atomic`'s own choice (20260916010000) exactly, since a review decision is a workspace-level fact about who decided what, not per-task activity.
- `sweep_overdue_blocking_deliverables` writes its audit trail via `write_task_activity_entry` (`task_activity`, per-task, visible to whoever can see the task including a portal client) instead — grepped both `20260821211226_create_audit_log.sql` (actor_id `not null references auth.users`, no system-actor path) and `20260822230000_create_task_activity.sql` (actor_id nullable, `p_system` parameter exists exactly for a no-human-session caller). `audit_log` cannot accept a cron-job write at all (its own `write_audit_log_entry` raises `'no authenticated actor'` when `auth.uid()` is null, and there is no p_system-style bypass for it anywhere in this schema); `task_activity` was built with exactly this need in mind (F195's recurrence job already uses the same `p_system => true` path). "Why did this task move to Blocked" is also a fact the task's own activity feed is the more natural place for a PM/client to find, not the workspace owner-only audit log.
- "The project's Blocked status" (spec's own phrase) resolves to `project_statuses.client_bucket = 'blocked'` (20260911010000), not a column named literally "Blocked" — grepped every `project_statuses` migration; `client_bucket` is the one place this schema already expresses "which board column reads as Blocked to the client" via a closed vocabulary, set by a PM in the board-columns settings screen (F004). A project with no column tagged `blocked` is skipped entirely by the sweep for that project's deliverables (nowhere to move the task; inventing a fallback would be a second, silent source of truth for what counts as "Blocked").
- Idempotency for the sweep is per TASK, not per (task, deliverable) pair: `distinct on (t.id)` (ordered by earliest-due deliverable, then position) guarantees at most one UPDATE and one `task_activity` row per task per run, even when two different overdue blocking deliverables point at the same task. The query's own `t.status_id is distinct from ps_blocked.id` filter is what makes a re-run (or a task already independently sitting in the blocked bucket) a no-op — read `20260823050000_overdue_notification_sweep.sql` first, per this feature's own instruction, before writing this one; that migration's idempotency backstop is a unique index on `notifications`, a different mechanism than this feature needed because there is no notifications-style insert here to dedupe — the dedupe is "don't move a task that's already there," enforced by the same WHERE clause that decides whether to act at all, not a separate backstop table/index.
- `accept_deliverable_atomic`'s `returned` branch also clears `delivered_at`/`accepted_at`/`accepted_by` (not just setting `state`/`review_note`, which is all the spec's own bullet literally says) — a returned item's history shouldn't still carry a "delivered at this timestamp" fact that this decision just superseded; the client must re-deliver, producing a fresh `delivered_at` whenever F014's client-side "mark delivered" action (out of this feature's scope) runs.
- The "linked task" picker in `deliverables-panel.tsx` is a plain `<Select>` fed by a project's full non-deleted task list, fetched inline in the settings page's own Server Component query (mirroring how that page already inlines its `projects` select) rather than a new `lib/queries/*` module or a `getProjectTaskOptions`-style Server Action — no such helper exists anywhere in this codebase today (grepped for `TaskOption`), and the read is a single project-scoped `.select("id, title")`, not complex enough to justify inventing one for this feature alone.
- `saveProjectAsTemplate` converts a deliverable's absolute `due_at` into a `due_offset_days` (days from today at save time) when snapshotting into a template payload — an absolute date has no meaning inside a reusable template (the same reasoning phases already skip `planned_start`/`planned_end` when snapshotted); `create_project_from_template` resolves it back to `current_date + due_offset_days` at creation time, inside the same RPC invocation/transaction as the project + tasks + phases.

## Out-of-scope work needed
- F014 (Portal: Your list view) needs the CLIENT-facing read/mark-delivered UI for `client_deliverables` — this feature only built the team management surface and the review (accept/return) RPC. There is currently no write path that ever sets a deliverable's state to `delivered` at all outside a hand-written admin-client test fixture; F014 owns that action.
- F014's overview "risk banner" (per plan.md's F006 note, "wired in M3") can now also reflect the blocking-sweep outcome (a task sitting in the blocked bucket for a deliverable reason) in addition to F012's `getOverdueBlockingDeliverableCount` — not wired here, the banner component itself is out of this feature's scope per F012's own handoff.
- No UI exists yet for a PM to tag a board column's `client_bucket = 'blocked'` on a project that doesn't already have one (F004 built the underlying column/schema per its own scope, but this mission's board-columns settings screen work for `client_bucket` specifically was not re-verified here) — if a project has no column tagged `blocked`, the sweep silently does nothing for that project's deliverables; there is no "the sweep couldn't do its job" surfaced anywhere to the PM. A future follow-up could have `getOverdueBlockingDeliverableCount`'s consuming badge (or the deliverables panel itself) warn when `blocking` is set on a project with no blocked-bucket column configured.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `task_activity` (not `audit_log`) for the sweep's audit trail — see "Decisions made" above for the full grep-backed reasoning; `audit_log`'s own `write_audit_log_entry` has no system-actor path at all, so it could not have been used for a cron job's writes even if it were otherwise the better semantic fit.
AUTONOMOUS_DECISION: Resolved "the project's Blocked status" to `project_statuses.client_bucket = 'blocked'` rather than a column named "Blocked" — see "Decisions made" above.
AUTONOMOUS_DECISION: Built the "linked task" picker as a plain inline Server Component query rather than a new reusable query/action module, since no such helper existed anywhere in the codebase to reuse or extend, and the read itself is a single trivial project-scoped select.

## Notes for the next worker
- No MCP was used for this feature — per this mission's explicit instruction ("The Supabase MCP is not authorised — use the CLI"), all schema work went through `npm run db:apply` / `npm run db:gen-types` against the CLI-linked project, and RLS/RPC behaviour was verified by exercising real signed-in sessions and `.rpc()` calls in `tests/integration/f013-deliverables-review-and-sweep.test.ts`, the same convention `tests/integration/f007-approvals-rls.test.ts` and `tests/integration/overdue-notification-sweep.test.ts` already established.
- `tests/integration/project-from-template.test.ts` has one PRE-EXISTING failing test (`test_AS_012_a_hidden_phases_client_visible_flag_survives_save_as_template_and_create_from_template`), unrelated to this feature — confirmed by `git stash`-ing every change in this handoff's Files list and re-running just that test in isolation: it fails identically on the pre-F013 codebase. Not investigated further (out of this feature's scope); flagging so it isn't mistaken for a regression this feature introduced.
- Ran only the tests specified/added by this feature plus the one existing template round-trip suite this feature's migration touches (`project-from-template.test.ts`, per the Definition of done's own side-effect verification instruction), not the full vitest suite, per instructions.
