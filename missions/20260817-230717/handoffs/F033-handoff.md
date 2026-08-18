# Handoff: F033 — db schema tasks

## Status
COMPLETE

## Assertions covered
AS-047: PASS — `tasks_status_check` CHECK restricts `status` to `todo`/`in_progress`/`in_review`/`done`; integration test inserts all four values successfully.
AS-048: PASS — direct admin-client insert with `status: "not_a_real_status"` is rejected by the DB.
AS-049: PASS — `tasks_priority_check` CHECK restricts `priority` to `urgent`/`high`/`medium`/`low`/`backlog` or NULL; all five values plus null insert successfully.
AS-050: PASS — direct admin-client insert with `priority: "not_a_real_priority"` is rejected by the DB.
AS-058: PASS — inserting a task without specifying `created_at`/`status`/`tags`/`position` shows `created_at` populated, `author_id` set to the inserting user, and the defaults (`status='todo'`, `tags='{}'`, `position=0`) applied.
AS-059: PASS — updating a task's `description` after a >1s delay shows `updated_at` strictly greater than the original value, via the reused `set_updated_at()` trigger.
AS-065: PASS — tasks created with zero, one, and multiple tags all persist the expected `text[]` value.
AS-066: PASS — updating `tags` to `[]` on a task that previously had tags results in `tags = []`, not `null`.

## Files changed
supabase/migrations/20260818013434_create_tasks.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`)
tests/integration/tasks-schema.test.ts

## Commands run
`supabase migration new create_tasks` (0)
`supabase db push` (0)
`supabase gen types typescript --linked > lib/supabase/database.types.ts` (0)
`npx vitest run tests/integration/tasks-schema.test.ts` (0) — 9/9 passed
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 30 files, 162 tests passed
`npm run build` (0)

## Decisions made
- Used CHECK constraints for `status` and `priority` rather than native Postgres enums, per tech-decisions.md and the feature spec's explicit clarification (avoids `ALTER TYPE` transaction-limitation issues if the value set grows later).
- Applied F100's lesson immediately instead of waiting for a follow-up: added `tasks_title_not_empty check (btrim(title) <> '')` in the same migration that creates the table, so `title` rejects empty/whitespace-only strings at the DB level from day one — not just `not null`.
- `author_id` is `not null references auth.users (id)` (no ON DELETE behavior specified since none was in scope); `assignee_id` is nullable, matching the single-assignee model described in later assertions (AS-051/AS-052, out of scope for this feature).
- Indexed `project_id`, `assignee_id`, and `status` individually, plus a composite `(project_id, status)` index for board-column queries, per the spec's suggestion that this composite is "likely most useful" once F044+ builds the Kanban board.
- Reused the existing `set_updated_at()` trigger function (established in `20260818004413_create_projects.sql`) rather than redefining it.
- No RLS added — F034 explicitly owns that; this table is currently open to any authenticated/service-role caller until F034 lands, same posture `projects` had between F024 and F025.
- Tests use the admin/service-role client directly (no Server Action exists yet for tasks — that's a later M4 feature), following the same direct-insert-bypass pattern `create-project.test.ts` uses for its CHECK-constraint assertions.

## Out-of-scope work needed
- RLS policies on `tasks` (F034) — table is currently unrestricted for any authenticated caller, same interim state `projects` had before its RLS feature landed.
- Server Actions for creating/editing/moving tasks, and the Zod schema mirroring the DB CHECK constraints (later M4 features) — this feature only covers the schema layer.
- AS-051/AS-052 (assignee must be a workspace member) is not enforceable via a plain FK to `auth.users`; it will need either an RLS/trigger check or Server Action validation once workspace-membership scoping for tasks is implemented — flagging for whichever future feature owns assignment logic.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous)

## Notes for the next worker
- Migration file: `supabase/migrations/20260818013434_create_tasks.sql`.
- `supabase db push` and `gen types` both worked without extra setup — the project link from prior M1-M3 work is still active.
- `tags` defaults to `'{}'` (empty array) at the DB level, not `null` — confirmed both at creation and via explicit clear-to-`[]` update (AS-066).
- New test file `tests/integration/tasks-schema.test.ts` follows the `create-project.test.ts` loadDotEnv/admin-client/skipIf pattern; cleans up all created tasks/projects/workspaces/users in `afterAll`.
