# Handoff: F112 — edit delete time entry action

## Status
COMPLETE

## Assertions covered
AS-169: PASS — author can edit own entry (minutes/billable/note/date); a different regular member, a workspace admin, and a workspace owner are all rejected server-side when editing another member's entry.
AS-170: PASS — author can delete own entry; workspace admin/owner can delete another member's entry; a different regular member is rejected.

## Files changed
lib/actions/time-entries.ts
lib/validation/time-entries.ts
tests/integration/edit-delete-time-entry.test.ts
missions/20260817-230717/handoffs/F112-handoff.md

## Commands run
`npx tsc --noEmit -p .` (0)
`npx eslint .` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/edit-delete-time-entry.test.ts` (0, 7/7 passed)
`npx vitest run tests/integration tests/unit` (0, 487/487 passed across 91 files)
`npx next build` (0)

## Decisions made
- editTimeEntry is author-only with no admin/owner override, per the spec's Clarified implementation — a workspace admin/owner is rejected identically to any other non-author. This is deliberately stricter than editTask (AS-061: any member) and comments' update RLS (author-or-admin), so I wrote three separate rejection tests (other member, admin, owner) rather than one, to prove the admin/owner override does NOT apply here — this is the one place in the app where "admin" isn't enough.
- deleteTimeEntry reuses `requireWorkspaceAdmin` (lib/auth/require-membership.ts) for the non-author path, exactly as instructed, rather than duplicating a role check.
- Both actions use the admin (service-role) client for the actual write, matching the established convention in this file (logTimeEntry/startTimer): the admin client bypasses RLS, but this is safe because authorization has already been independently re-verified server-side above (author match, or requireActiveMembership/requireWorkspaceAdmin) — same pattern as editTask/deleteTask in lib/actions/tasks.ts.
- No RLS UPDATE/DELETE policy was added to `time_entries` (the F108 migration's comment anticipated F112 might add author-or-admin RLS policies mirroring comments' `can_modify_comment`). I did not add one: the feature spec's file scope is `lib/actions/time-entries.ts (extend)` only, no migration is listed, and — critically — a single author-or-admin RLS UPDATE policy on the table would be *wrong* here since AS-169's edit rule (author-only, no admin override) differs from AS-170's delete rule (author-or-admin) and RLS policies are per-operation but this table's real enforcement already happens correctly in the Server Action layer before the admin client is ever used, so an RLS policy add is optional hardening, not required for correctness. Documented as an out-of-scope note below in case a future defense-in-depth pass wants it.
- editTimeEntry's Zod schema makes `note` `.nullable()` (not just `.optional()`) so a caller can explicitly clear an existing note by passing `null`, distinct from omitting the field (which leaves it untouched) — mirrors editTaskSchema's `description` field convention in lib/validation/tasks.ts.
- Both actions treat "entry not found", "not the author", and "not an active member" with the same generic user-facing error text, never revealing which reason applied (matches AS-146's generic-error convention already used throughout this file).

## Out-of-scope work needed
- Optional hardening: add RLS UPDATE (author-only) and DELETE (author-or-admin, via a `can_modify_time_entry`-style SECURITY DEFINER function mirroring comments' `can_modify_comment` in supabase/migrations/20260818041550_rls_comments_delete_update.sql) policies on `time_entries`, purely as defense-in-depth behind the Server Action checks — not required today since the admin client bypasses RLS and the app-layer checks are the actual enforcement boundary, same as every other action in this file.
- No UI wiring (edit/delete controls on time entry rows) was done — spec scope was the Server Actions only.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `.maybeSingle()` + a joined `tasks(deleted_at, projects(workspace_id))` select for both actions' entry lookup (rather than two separate queries), consistent with logTimeEntry/startTimer's single-query task->project->workspace lookup pattern already established in this file.
AUTONOMOUS_DECISION: deleteTimeEntry performs a real `DELETE` (not a soft delete) since `time_entries` has no `deleted_at` column per the F108 migration.

## Notes for the next worker
- The three admin/owner-cannot-edit tests in tests/integration/edit-delete-time-entry.test.ts are the important regression guard for AS-169's stricter-than-usual model — if a future worker "fixes" editTimeEntry to allow admin override (e.g. by copy-pasting deleteTimeEntry's pattern), these tests will catch it.
- Test file follows the exact loadDotEnv/vi.mock/skipIf(!haveAdminCreds) scaffolding from tests/integration/log-time-entry.test.ts — reuse that file as the template for any further time_entries integration tests.
