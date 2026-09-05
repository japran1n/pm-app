# F011b: The immutability guarantee makes task deletion impossible

**Milestone:** M2 remediation — **blocker**
**Estimated worker time:** 1.5 h
**Opened by:** the M2 gate, orchestrator-verified

## The defect

F011 added:

```sql
alter table approval_requests
  add column resulting_task_id uuid references tasks (id) on delete set null;
```

That column is only ever written on a row the same statement settles. And
a referential `SET NULL` is a real UPDATE: it fires row triggers. So
`prevent_approval_request_settled_update` raises `42501` and aborts the
parent DELETE.

The chain: client requests changes → a task is created and linked → the
team trashes that task → `purge_task` fails, permanently, and
`lib/actions/purge.ts:166` shows the user a generic error. There is no
way out through the UI.

The migration's own header at lines 11-16 asserts this cannot happen.
That is true for direct writes and false for the path the same migration
created. F011's test `afterAll` hits the failure and swallows it.

Verified: `on delete set null` is on line 80 of
`20260923010000_f011_changes_requested_creates_task.sql`.

## Assertion IDs covered
- AS-024: A recorded approval decision cannot be edited or deleted; a changed mind requires a new approval request.

## Scope

1. Decide how the two rules coexist and say why in the handoff. The
   options are real and have different costs — the trigger can exempt
   this one column when the UPDATE originates from a referential action,
   the FK can become `on delete no action` with the link cleared
   explicitly before the delete, or the link can live in a side table
   that carries no immutability rule. Pick one, and say what it costs.
2. Whatever you choose, the guarantee AS-024 states must survive: a
   settled decision's own fields — state, decided_by, decided_at,
   decision_note — remain unwritable.
3. Fix F011's test so it does not swallow this in `afterAll`. A cleanup
   block that hides the failure your feature introduces is how this
   reached the gate.

## Definition of done

- **Primary success test:** create a changes_requested decision, trash
  the resulting task, purge it. The purge succeeds and the approval row
  survives with its decision fields unchanged.
- **Failure test:** a direct UPDATE to `state`, `decided_by`,
  `decided_at` or `decision_note` on a settled row is still rejected.
- **Manual verification:** the migration header's claim matches what the
  code now does.
- **Side-effect verification:** F011's atomicity test still passes; task
  trash and purge work normally for unrelated tasks.
