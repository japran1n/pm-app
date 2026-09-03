# Handoff: F011 — Request changes creates real work

## Status
COMPLETE

## Assertions covered
AS-025: PASS — `decide_approval_atomic('changes_requested')` creates exactly one task in the approval's project carrying the client's note (verbatim, attributed, dated), assigned to the requester, `client_visible=false`, linked back via `approval_requests.resulting_task_id`, and (when the subject is a task) posts the same note as a comment on it — all in one transaction. Forced-failure test proves that when one of this decision's own writes fails, the entire transaction (task, comment, and the decision itself) rolls back — no half-landed state. See `tests/integration/f011-decide-approval-creates-task.test.ts`.

## Files changed
supabase/migrations/20260923010000_f011_changes_requested_creates_task.sql
lib/actions/approvals.ts
lib/actions/portal-approval.ts
components/portal/approval-card.tsx
components/portal/approval-card.test.tsx
components/approvals/request-approval-dialog.tsx
tests/integration/f011-decide-approval-creates-task.test.ts
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20260923010000_f011_changes_requested_creates_task.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/f011-decide-approval-creates-task.test.ts tests/integration/f007-approvals-rls.test.ts tests/integration/f008-request-approval-action.test.ts tests/integration/f009-decide-approval-action.test.ts tests/integration/f010-approvals-queue.test.ts tests/unit/portal-approval-action.test.ts components/portal/approval-card.test.tsx` (0, all pass — 83 tests)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/approvals.ts lib/actions/portal-approval.ts components/portal/approval-card.tsx components/approvals/request-approval-dialog.tsx tests/integration/f011-decide-approval-creates-task.test.ts components/portal/approval-card.test.tsx` (0)

## Decisions made
- Extended `decide_approval_atomic` in place (same RPC F007/F008/F009 already built around) rather than a second RPC — the spec's own "in the same transaction" requirement is satisfied for free by one Postgres function body, matching every other atomic RPC's own precedent in this schema (grep: `supabase/migrations/20260916010000_approval_requests.sql:230-370`, `20260906010000_portal_task_actions_project_visibility.sql:99-160`).
- `RETURNS TABLE` gained a column (`resulting_task_id`), which Postgres rejects via plain `create or replace function` ("cannot change return type of existing function") — added an explicit `drop function if exists ... ; create or replace function ...` pair in the same migration, confirmed necessary by running `db:apply` once without it and seeing the `42P13` error.
- Task-insert column resolution:
  - **status**: the project's first `not_started`-category status by position, falling back to the project's first status of any category. Verified this can never actually be null in practice: `admin.from('project_statuses').delete()` against a project's last remaining status row is rejected by `prevent_last_project_status_delete` (`supabase/migrations/20260824020000_project_statuses_management.sql:46-61`, message "A project must have at least one board column.") — confirmed by hand with a throwaway script before writing the RPC, not assumed.
  - **position**: `coalesce(max(position) + 1000, 1000)` for that (project, status) — the same DEFAULT_POSITION/BOUNDARY_GAP=1000 shape `lib/board/position.ts`'s `calculatePosition` computes for an empty-neighbor insert; there is no JS boundary reachable from SQL, so the arithmetic is inlined rather than re-derived differently.
  - **task_type_id**: the subject task's own `task_type_id` when the subject is a task, else `null`.
  - **assignee_id**: the approval's `requested_by` (spec, explicit).
  - **client_visible**: `false`, set explicitly (spec: "the team decides what to show").
  - **description**: `p_note` verbatim, plus one `— requested by <name>, <date>` attribution/date line (never truncated or paraphrased).
- Comment on the subject task (F024 carry-over, "comment first, then flags"): inserted directly into `comments` from inside the SECURITY DEFINER function — no mention parsing / notification fan-out, since the function has no app-layer session to route through `addComment` and the text is not a client composer input, it's the just-recorded decision note. Ordered before the `approval_requests` UPDATE and the `pending_client_approval` clear, matching the mission's own "comment first, then flags" instruction.
- **Rounds** (spec section 2): implemented in `requestApproval` (`lib/actions/approvals.ts`), not in `decide_approval_atomic` — raising, not deciding, is where the next round begins. Matches on `(project_id, subject_type, subject_id)` for task/doc/phase subjects, or `(project_id, subject_type, artifact_url)` for an artifact (no `subject_id`), ordered by `round desc`, and writes `round = previous.round + 1` / `supersedes_id = previous.id`.
- **Round >= 3 suggestion** (spec section 2, dialog): surfaced as a second, dismissible `toast.message(...)` in `RequestApprovalDialog` right after a successful submission, using the round the newly-created request landed at (returned from `requestApproval`). Deliberately a suggestion only, never a blocked submission or a changed outcome — "the tool does not get to decide that a client is being unreasonable" (spec's own words).
- **Portal card** (spec section 3): `ApprovalCard`'s settled panel, for `changes_requested` only, adds a `"We've logged this as work for the team."` line once the server confirms `resultingTaskId`. Deliberately plain text, never a `Link` — the created task is never `client_visible` by default, so there is nothing safe to link to, regardless of whether the id is known client-side.

## Out-of-scope work needed
- No "raise a change request" route/page exists yet (F016, M3) for the round>=3 suggestion to link to — the toast names the situation but does not link anywhere. When F016 lands, that toast should gain a link/action, matching the spec's "with a link to raise one."
- This project's schema has no "project default task type" concept anywhere (grep confirms: no `default_task_type_id` column on `projects`, no such concept in `task_types`). The spec's "task_type: ... else the project's default" therefore falls back to `null` here rather than a fabricated concept — a future feature that actually adds a per-project default task type should also update this RPC's `else null` branch to read it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: "the project's default" task type (spec section 1, task_type bullet) has no corresponding schema concept anywhere in this codebase (confirmed by grep across all migrations). Used `null` as the fallback rather than inventing a new column/concept not asked for by any assertion — AS-025 does not mention task type at all, and adding a whole new "default task type" feature would be scope creep beyond this feature's own file list.
AUTONOMOUS_DECISION: the forced-failure test targets the comment insert against `subject_id` (which carries no FK by design, per `approval_requests`' own migration comment) rather than the task insert itself, because every column the task INSERT writes is guaranteed valid by other constraints already enforced earlier in the same call (project always has >= 1 status via a DB trigger confirmed by hand; requested_by/decided_by are FK-guaranteed; phase_id/task_type_id use ON DELETE SET NULL so they can never dangle) — the task insert is, by this schema's own design, not reachable to fail via the REST API. The forced failure still proves the exact invariant AS-025's failure test asks for: when any write this decision makes fails, the whole transaction — decision and the already-inserted task included — rolls back.

## Notes for the next worker
- `decide_approval_atomic`'s `RETURNS TABLE` shape now includes `resulting_task_id` — any other caller of this RPC (there is currently only `lib/actions/portal-approval.ts`'s `decideApproval`) must destructure the 4th column, not assume the old 3-column shape.
- The `approval-card.test.tsx` mocks used a `data` shape that omitted `resultingTaskId` before this feature; both existing mocks that assert on a `changes_requested` result were updated to include it (harmless for the tests that don't check the "logged as work" line — `?? current` fallback in the component keeps `resultingTaskId` `undefined` rather than crashing when a mock omits it).
- No Supabase MCP was used (not authorised in this session, per the mission's own instruction) — all schema introspection/verification went through the CLI (`npm run db:apply`, `npm run db:gen-types`) and direct throwaway Node scripts against the admin/service-role client (e.g. confirming `prevent_last_project_status_delete` actually blocks emptying a project's statuses, before relying on that invariant in a code comment).
