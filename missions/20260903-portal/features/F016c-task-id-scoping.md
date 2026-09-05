# F016c: A deliverable can point at another workspace's task

**Milestone:** M3 remediation — **blocker**
**Estimated worker time:** 2.5 h
**Opened by:** the M3 gate, orchestrator-verified

## The defect

`client_deliverables.task_id` is declared as
`uuid references tasks (id) on delete set null`
(`20260926010000:44`) with **no constraint that the task belongs to the
same project**, and `lib/actions/deliverables.ts:225,294` write it
through the service-role client without checking it against
`ctx.projectId`. Verified.

Two consequences, both live:

1. **An hourly cross-workspace write.**
   `sweep_overdue_blocking_deliverables` (`20260927010000:214`) joins
   `tasks t on t.id = cd.task_id` and separately `projects p on p.id =
   cd.project_id`, with nothing tying `t` to `p`. It then resolves the
   Blocked status from `cd.project_id`. So cron sets a foreign project's
   task to a `project_statuses` row that project does not own — every
   hour, silently.

2. **A cross-workspace read leak.** `resolveHoldsUpContext`
   (`lib/queries/deliverables.ts:174,192`) reads `tasks` and
   `project_phases` through the admin client scoped only by id, so
   another workspace's task title renders as a "holds up" label in this
   client's portal. The function's own doc comment says this cannot
   happen.

## Assertion IDs covered
- AS-028, AS-031 (the deliverable's project scoping)
- AS-054 (a row that is not client-visible is absent from every path)

## Scope

1. **Constrain it in the schema.** A composite foreign key against
   `(id, project_id)` — adding the matching unique index on `tasks` if
   one is needed — is the version the database enforces for everyone,
   including a future service-role writer who forgets. Prefer that over
   a trigger; say why in the handoff if you cannot.
2. Fix the sweep's join so a task is only ever blocked by a deliverable
   in its own project.
3. Fix `resolveHoldsUpContext` to scope by project, and correct its doc
   comment, which currently asserts the invariant the code does not
   enforce.
4. Validate `task_id` in `lib/actions/deliverables.ts` against
   `ctx.projectId` before writing, so the error is caught where it can
   be explained rather than at the constraint.
5. **Check for existing bad rows** before adding the constraint. If any
   deliverable already points across projects, decide what happens to
   it and say so — a migration that fails on real data at deploy time is
   a defect this mission has already shipped once (F006h).

## Definition of done

- **Primary success test:** a deliverable cannot be created or updated
  with a `task_id` from another project, enforced by the database when
  called directly as service-role.
- **Failure test:** the sweep, run against a database containing a
  cross-project pairing, blocks nothing; the portal's "holds up" label
  never names a task from another project.
- **Manual verification:** the constraint is checked against existing
  data before it is added.
- **Side-effect verification:** F013's and F014's tests pass; the sweep
  still blocks correctly-scoped tasks.
