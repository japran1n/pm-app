# Handoff: F011b — The immutability guarantee makes task deletion impossible

## Status
COMPLETE

## Assertions covered
AS-024: PASS — `test_AS_024_purge_of_a_linked_resulting_task_succeeds_and_the_settled_decision_survives_unchanged` and `test_AS_024_a_direct_update_to_a_settled_decisions_own_fields_is_still_rejected`, both in `tests/integration/f011-decide-approval-creates-task.test.ts`, run green against the real linked Supabase project.

## Files changed
supabase/migrations/20260924010000_f011b_purge_blocked_by_immutability.sql
tests/integration/f011-decide-approval-creates-task.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260924010000_f011b_purge_blocked_by_immutability.sql` (0)
`npx vitest run tests/integration/f011-decide-approval-creates-task.test.ts` (0, 4/4 passed)
`npx vitest run tests/integration/purge-trash-item.test.ts tests/integration/f007-approvals-rls.test.ts` (0, 36/36 passed — side-effect verification: F192 purge and F007 approvals RLS unaffected)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f011-decide-approval-creates-task.test.ts` (0)

## Decisions made
- **Root cause confirmed by reading, not assumption**: `purge_task`'s `delete from tasks where tasks.id = p_task_id` (supabase/migrations/20260822220000_purge_task_and_comment.sql:114) does not clear `approval_requests.resulting_task_id` first. `resulting_task_id uuid references tasks (id) on delete set null` (20260923010000, line 80) turns that DELETE into a real `UPDATE approval_requests SET resulting_task_id = NULL ...` on the linking row when one exists, which fires `approval_requests_block_settled_update` (20260916010000) — a BEFORE UPDATE FOR EACH ROW trigger with an unconditional `if OLD.state <> 'pending' then raise exception ... using errcode = '42501'`. For a settled `changes_requested` decision that row's state can never return to `'pending'`, so the purge fails permanently, exactly as `lib/actions/purge.ts:166` logs it and surfaces a generic error.
- **Of the spec's three options, chose (1): the trigger exempts the write, but by checking effect (which columns changed) rather than origin (why the UPDATE fired).** Postgres gives a row trigger no supported way to distinguish "this UPDATE was queued by a FK's ON DELETE SET NULL action" from "a session ran an UPDATE by hand" — both present identically as `TG_OP = 'UPDATE'` with a normal OLD/NEW pair. So instead of trying to detect origin, the rewritten `prevent_approval_request_settled_update()` checks the four fields AS-024 actually names — `state`, `decided_by`, `decided_at`, `decision_note` — via `IS DISTINCT FROM`, and only raises if one of those changed. `resulting_task_id` (and any other non-guarded column) can now be written on a settled row; the four decision fields still cannot, from any source, including the RPC's own second/racing call, matching the original trigger's stated intent.
- **Cost, stated in the migration's own header comment** (supabase/migrations/20260924010000_f011b_purge_blocked_by_immutability.sql): the trigger no longer blocks every column on a settled row — it blocks four named columns. A future column added to `approval_requests` that should also be frozen once settled is NOT automatically covered; whoever adds it must audit this trigger, the same way any column addition already has to audit `approval_requests_update_team`'s WITH CHECK (20260916010000), which already has the identical "deny by naming columns" shape. This is the real cost of choosing "check effect" over "check origin": it trades a currently-unreachable detection mechanism for an explicit, auditable list that must be kept in sync by hand.
- **Rejected (2) `on delete no action` + explicit clear in `purge_task`**: pushes the "clear this FK before the delete" duty onto every present and future hard-delete call site — `purge_task` is not alone; `cascade_delete_task` (20260819071821_subtask_cascade_delete.sql) also hard-deletes tasks and would need the identical addition, with no schema-level guarantee that a future third call site remembers it. The trigger-side fix instead makes correctness a property of the schema, not of every caller's discipline.
- **Rejected (3) move the link to a side table with no immutability trigger**: `resulting_task_id` already carries no immutability protection of its own — 20260923010000's own header (lines 11-16 of that file) states this explicitly ("No trigger guards it against later mutation the way `state` is guarded... this column is only ever written once, inside this same function, at the moment the row is first settled"). Moving it to a side table doesn't remove a rule that was never applied to it; it only adds a table and a join to every future read of "what task did this decision create," for no additional safety.
- Fixed the F011 test's `afterAll`: every cleanup delete now checks its `error` and throws with the failing step's label instead of being awaited and discarded. Also added two dedicated AS-024 tests: the primary-success path (create `changes_requested` decision → trash the resulting task → `purge_task` via the real RPC → decision survives with its four fields byte-identical, `resulting_task_id` now null) and the failure path (direct UPDATE to each of `state`/`decided_by`/`decided_at`/`decision_note` on a settled row still returns Postgres error code `42501`).
- Noted for the record, since I checked rather than assumed: the *original* `afterAll` (before this fix) deleted `approval_requests` before `tasks`, so it never actually reproduced the defect during cleanup — a row already DELETEd can't be blocked from being UPDATEd by a later FK action against a table it no longer exists in. The "swallowed failure" the spec describes is a real risk in that unchecked-error pattern, not something this specific ordering happened to trigger; the new dedicated test is what forces the bug's actual path (`tasks` row gone while the settled `approval_requests` row still points at it).

## Out-of-scope work needed
None identified beyond this feature's scope. `cascade_delete_task` (20260819071821_subtask_cascade_delete.sql) is a second task hard-delete path — worth a follow-up sanity check that it hits the same now-fixed trigger path if it can ever be called against a task with a settled, linked `approval_requests` row, but I did not find evidence it's reachable for a task with resulting_task_id set (that link only exists on tasks created BY `decide_approval_atomic`, and cascade_delete_task's own call sites were out of this feature's Touches). Flagging only; not acting on it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "check effect (named columns) not origin" over trying any `pg_trigger_depth()`/session-variable trick to detect a referential-action-originated UPDATE, because no such trick is a supported, non-fragile signal in a BEFORE ROW trigger, and the spec's own option (1) wording ("exempt this one column") is satisfied just as well, and more robustly, by naming the guarded columns explicitly.

## Notes for the next worker
No MCP tools used — this was a pure migration + SQL trigger fix; Supabase MCP is not authorised for this mission per the assignment instructions, and `npm run db:apply` / `db:gen-types` (CLI) were used instead, per the assignment. Migration file: `supabase/migrations/20260924010000_f011b_purge_blocked_by_immutability.sql`, applied via `npm run db:apply -- supabase/migrations/20260924010000_f011b_purge_blocked_by_immutability.sql` (exit 0, confirmed applied and recorded).
