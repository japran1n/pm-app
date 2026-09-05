# F016j: The seventh instance, on a column added after the sixth was fixed

**Milestone:** M3 remediation
**Estimated worker time:** 1.5 h
**Opened by:** the M3 third gate

## The defect

`client_requests.origin_assumption_id` (added by F016b) is:

- writable by a client at INSERT,
- absent from F016f's guard-trigger column list,
- dereferenced at `20261003010000:280-285` with **no project
  predicate**.

That is precisely the shape of the `approval_request_id` hijack F016f
closed — on a column introduced one migration later.

## Why this keeps happening, stated plainly

This is the seventh occurrence of one class in this mission: a rule
enforced on one path or column and absent on its sibling. F006b, F006i,
F006k, F006l, F009b, F016d, and now this.

F016d was the structural answer for the RPCs and it worked — no RPC has
regressed since. F016f extended the guard to INSERT and that worked too.
What neither did was make the guard's **column list** self-maintaining.
It is still a hand-written enumeration, so any migration that adds a
column to `client_requests` silently opts out of the protection, and
F016b did exactly that within a day.

So this feature fixes the instance and then closes the enumeration.

## Scope

1. Add `origin_assumption_id` to the guard, and a project predicate
   where it is dereferenced.
2. **Invert the guard's column list.** Instead of enumerating the
   columns a client may not write, enumerate the few they may — the
   fields of a request they legitimately author — and reject changes to
   anything else. A column added next year is then protected by default
   rather than exposed by default. This is the same inversion F009d
   proposes for the approvals immutability trigger; if you can share one
   helper between the two, do, and say so.
3. A test that adds a column to the table in a transaction and proves
   the guard covers it without being edited.

## Definition of done

- **Primary success test:** a client cannot set `origin_assumption_id`
  at INSERT or UPDATE, called directly.
- **Failure test:** a client can still create an ordinary request with
  the fields they legitimately author.
- **Manual verification:** the guard's list is an allow-list; a new
  column is covered without touching it.
- **Side-effect verification:** F016b's, F016f's and F016's suites pass.
