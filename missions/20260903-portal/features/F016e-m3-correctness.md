# F016e: The four M3 correctness defects

**Milestone:** M3 remediation
**Estimated worker time:** 2.5 h
**Opened by:** the M3 gate

## The four

1. **AS-003 — the badge and the view disagree.** The badge query adds
   `.eq("blocking", true)`; the assertion has no such qualifier, and the
   Your-list view classifies past-due differently. So the sidebar says
   one number and the page it links to shows another. Both paths are
   tested against themselves, so neither test can see it.

   Decide which definition is right — the assertion's wording is
   "deliverables that are past their due date", with no blocking
   qualifier — then make one query serve both surfaces, as F006f did for
   the approvals tile and list. Do not fix the badge and leave two
   queries.

2. **AS-048 — a client sees only their own change requests.**
   `created_by = auth.uid()` scopes the portal's change-request list to
   the requesting user, but the assertion says the portal shows *each*
   change request. Two people from the same client company each see half
   the picture, and neither knows it. Scope by project, as every other
   portal surface does.

3. **Re-quoting duplicates scope items and orphans an approval.** Sending
   a second quote for a request that already has one leaves the first
   approval live; approving that stale one silently does nothing, and
   approving both inserts two `project_scope_items` rows for one piece
   of work. Withdraw the prior approval when a new quote is sent, and
   make the scope-item insert idempotent for a given request.

4. **The sweep re-blocks a manually unblocked task.** F013's header says
   the sweep only ever moves a task into Blocked and never out — true —
   but nothing stops it moving the same task back in an hour after a
   human deliberately unblocked it. The test named for that case never
   re-runs the sweep, so it proves nothing.

   Record on the deliverable that its task was swept once, and do not
   re-sweep the same pair. A human's decision to unblock must outlast
   the next cron tick.

## Assertion IDs covered
- AS-003, AS-048

## Definition of done

- **Primary success test:** the sidebar badge and the Your-list view
  report the same number for the same project, from one query.
- **Failure tests:** two client users of one project each see all of the
  project's change requests; re-quoting produces exactly one live
  approval and one scope item; the sweep run twice around a manual
  unblock leaves the task unblocked.
- **Manual verification:** the sweep test actually re-runs the sweep.
- **Side-effect verification:** F013's, F014's and F016's suites pass.
