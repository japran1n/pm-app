# F009d: Two follow-ups from the M2 pass

**Milestone:** M2 — non-blocking, run when there is a gap
**Estimated worker time:** 1 h
**Opened by:** the M2 re-scrutiny, which passed the milestone

## FM — freeze approval columns by allow-list, not deny-list

F011b narrowed the immutability trigger to four named columns, which was
correct and fixed the purge blocker. The consequence: `service_role`
could now rewrite `subject_id`, `project_id`, `artifact_url` or `round`
on a settled row. Nothing does — the reviewer checked all four `update
approval_requests` sites in the migrations and found them pending-only,
with no admin-client update in app code.

So this is defence in depth, not a live hole. But the shape is one this
mission has been bitten by four times: a rule that lists what is
forbidden goes stale the moment someone adds a column.

Invert it: compare `to_jsonb(NEW)` against `to_jsonb(OLD)` minus an
explicit allow-list of columns that may change on a settled row, so a
column added next year is frozen by default rather than free by default.

## FN — the wrong message on a correct refusal

On a project where no decision owners were ever configured, the legacy
portal Approve control now fails with the generic "Something went
wrong." The authorisation outcome is right; the message is useless. The
client cannot tell a permissions rule from a crash, and the PM gets a
bug report instead of a configuration prompt.

Say what actually happened: nobody on their side has been named as the
approver for this kind of decision, and their contact at the agency can
set that. Check what the Approvals view says in the same situation and
match it.

## Definition of done

- **Primary success test:** with the allow-list trigger, an update to a
  column not on the list is rejected on a settled row, including as
  `service_role`; the purge path still works.
- **Failure test:** a settled row's four decision fields remain
  unwritable — F011b's tests still pass unchanged.
- **Manual verification:** the no-owner refusal reads as a
  configuration problem, not a crash, on both approval surfaces.
