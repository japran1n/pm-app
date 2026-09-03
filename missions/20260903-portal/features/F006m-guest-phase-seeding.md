# F006m: Guests can create phases one at a time but not ten at once

**Milestone:** M1 remediation, round 3 — minor
**Estimated worker time:** 45 min
**Opened by:** the third M1 scrutiny

## The defect

F006i added `is_project_visible_to` to `seed_default_phases`, which
excludes `guest`. The app-layer gate admits guests on workspace-visible
projects, and a guest can still create phases one at a time through the
normal action.

So "Add the standard ten phases" now hard-fails for a user who is
allowed to do the same thing ten times by hand. A security fix that
disagrees with the surface it is protecting is a bug in the fix.

## Scope

Align the RPC's bar with the Server Action's. Read
`lib/actions/phases.ts`'s gate first and match it exactly rather than
picking a bar that seems reasonable — the two must agree by
construction, and if they should not, the Server Action is the one to
change and that is a bigger decision than this feature.

Add a test for a guest on a workspace-visible project: the RPC and the
single-phase action agree.

## Definition of done

- **Primary success test:** a guest who can create a phase individually
  can also seed the ten.
- **Failure test:** F006i's actual fix survives — a member outside
  `project_members` of a **private** project still cannot seed.
- **Side-effect verification:** F006i's and F006j's tests still pass.
