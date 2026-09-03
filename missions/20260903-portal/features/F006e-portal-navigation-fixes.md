# F006e: Reachability and titles in the portal shell

**Milestone:** M1 remediation
**Estimated worker time:** 1 h
**Depends on:** F003, F003b
**Opened by:** the M1 scrutiny review

## The defects

1. **Files and Requests are unreachable.** F003 deleted
   `portal-nav.tsx`, which was the only navigation to them; F003b then
   moved them under the project shell without adding an entry point.
   They render correctly and nothing links to them. F003b's spec said
   they would be reached from Your site (F023) and Scope (F016) — both
   of which are still stubs, so in the meantime they are orphaned.
2. **The topbar prints "Overview"** on all three relocated routes,
   because the title is derived from a nav list that does not contain
   them.

## Assertion IDs covered
- AS-001, AS-004 (reachability and correct labelling of the shell)

## Scope

1. Give Files and Requests a temporary home in the sidebar, below the
   eight views, visually secondary. When F016 and F023 land they move
   into those views and the temporary entries go — say so in a comment
   so the next person removes them rather than inheriting them.
2. Derive the topbar title from the route rather than from the nav
   list, so any route added later is titled correctly by construction
   instead of by remembering to update a second list. A task detail
   route shows the task's title.
3. Check the same failure for the task-detail route's breadcrumb.

## Definition of done

- **Primary success test:** every route under `app/(portal)` renders a
  topbar title that is not "Overview" unless it is the overview.
- **Failure test:** adding a route without touching the nav list still
  produces a correct title.
- **Manual verification:** Files and Requests are reachable in two
  clicks from anywhere in the portal.
- **Side-effect verification:** the eight primary views keep their
  labels and active states.
