# F013: Team UI — client obligations

**Milestone:** M3
**Estimated worker time:** 2.5 h
**Depends on:** F012

## Assertion IDs covered
- AS-028: A project can hold a list of items the client owes.
- AS-030: An item the client has uploaded remains counted as outstanding until a team member accepts it.
- AS-032: A team member can accept a deliverable or return it with a required comment, and the client sees which happened.

## Scope

### 1. Management surface

A "What we need from the client" panel in the project — as a tab beside
the phases settings, not buried in settings, because a PM edits this
weekly rather than once.

Rows: title, kind, owner name, due date, blocking toggle, linked task,
state. Inline add; reorder by position.

### 2. The blocking link

When a `blocking` deliverable passes its due date, its linked task moves
to the project's `Blocked` status with a reason naming the deliverable.
Do this in a scheduled job, following the existing pg_cron precedent in
`20260823050000_overdue_notification_sweep.sql` — read that migration
before writing yours.

Two rules:
- The sweep only ever moves a task **into** Blocked. It never moves one
  out — a human decides when something is unblocked, because the arrival
  of a file is not the same as the work being unstuck.
- It is idempotent. A task already Blocked for this reason is left
  alone, and no second audit row is written.

### 3. Review

`accept_deliverable_atomic(id, decision, note)`:
- `accepted` → sets state, `accepted_at`, `accepted_by`, audit row.
- `returned` → back to `in_progress`, stores `review_note`, audit row.
  An empty note is rejected. "Send it again" with no reason is how a
  client learns to ignore the portal.

AS-030 lives here: `delivered` is not `accepted`, and only `accepted`
stops counting against the project.

### 4. Seeding from a template

Extend the `kind='project'` template payload (`task_templates`,
`create_project_from_template`) with a `deliverables[]` section, so the
standard content list arrives with the project instead of being typed
per client. Keep the payload backward compatible — old templates without
the section must still create projects.

## Files (approximate)

- `components/project/deliverables-panel.tsx`
- project route + `components/project-tabs.tsx`
- `lib/actions/deliverables.ts`, `lib/validation/deliverables.ts`
- migration: `accept_deliverable_atomic` + the pg_cron sweep + template payload
- `lib/validation/templates.ts`

## Definition of done

- **Primary success test:** integration — accept and return both work
  through the RPC and write audit rows; a returned item is outstanding
  again.
- **Failure tests:** returning with an empty note is rejected; a
  `viewer` and a `client` are rejected by every mutation.
- **Manual verification:** the sweep blocks a task for an overdue
  blocking deliverable, and running it twice changes nothing the second
  time.
- **Side-effect verification:** creating a project from an existing
  template that has no `deliverables[]` section still works.
