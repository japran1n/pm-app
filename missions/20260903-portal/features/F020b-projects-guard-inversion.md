# F020b: The projects guard is still a deny-list, and a client can unfreeze the baseline

**Milestone:** M4 remediation — **blocker**
**Estimated worker time:** 2 h
**Opened by:** the M4 gate, orchestrator-verified

## The defect

F020 added `projects.baseline_frozen_at` and did not extend F006k's
`projects` field-role trigger. Verified: zero occurrences of
`baseline_frozen_at` in
`20260919010000_projects_portal_launch_role_gate.sql`.

`projects_update_active_members` has no role restriction, so **any**
active workspace member — including a `client` or a `viewer` — can
`PATCH {"baseline_frozen_at": null}`. After that a writer edits the
baseline and re-freezes, and the "frozen" guarantee the whole Results
view rests on is gone.

Two more holes in the same trigger:

- It is `BEFORE UPDATE` only, so delete-then-reinsert bypasses it. F016f
  learned this exact lesson on `client_requests` and extended that guard
  to `BEFORE INSERT OR UPDATE`; `projects` never got the same treatment.
- `direction` stays editable, so flipping every "Regressed" badge to
  "Improved" needs no baseline write at all.

## The eighth instance, and what we actually missed

This is the same class as F006k itself: a column added to a table whose
write guard nobody re-read. F006k's own spec asked for a sweep of every
column this mission had added to a pre-existing table, and that sweep
came back clean — because F020's column did not exist yet.

F016j solved this properly for `client_requests` by inverting its guard
from an enumeration to an allow-list computed from the live schema. We
never applied the same inversion to `projects`. So one table is now
self-maintaining and the other is still a list somebody has to remember,
and the very next column added to it walked straight through.

## Scope

1. Invert the `projects` guard to an allow-list, exactly as F016j did
   for `client_requests` — enumerate the columns an ordinary member may
   write (name, description, dates: AS-029's behaviour) and reject
   changes to everything else. Share F016j's helper if one exists.
2. Extend it to `BEFORE INSERT OR UPDATE`.
3. Gate `project_metrics.direction` and the baseline fields so a
   non-writer cannot flip a regression into an improvement.
4. Tests calling PostgREST directly as a client and as a viewer for:
   unfreezing, delete-then-reinsert, and editing `direction`.

## Definition of done

- **Primary success test:** a client and a viewer are each rejected when
  setting `baseline_frozen_at`, called directly.
- **Failure test:** an ordinary member can still edit a project's name
  and dates — AS-029's behaviour, which F006k preserved and this must
  too.
- **Manual verification:** a column added to `projects` in a rolled-back
  transaction is covered by the guard without editing it.
- **Side-effect verification:** F006k's, F020's and F021's suites pass.
