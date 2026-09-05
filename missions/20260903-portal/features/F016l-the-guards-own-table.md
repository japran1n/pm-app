# F016l: The table that guards the guard has no guard

**Milestone:** M3 remediation — **blocker**
**Estimated worker time:** 1 h
**Opened by:** the M3 fourth gate

## The defect

`public.f016i_gated_function_oids` — the bookkeeping table F016i created
so its event trigger knows which functions it has already processed — is
**the only RLS-less table in `public`**, with anon SELECT, INSERT,
UPDATE and DELETE, live over PostgREST. The reviewer proved it rather
than inferring it: an anon-key `POST /rest/v1/f016i_gated_function_oids`
with `{"oid": 999999}` returned 201, and the probe row was deleted
again.

Two consequences, and both undo the feature that created the table:

- **Anon inserts plausible future oids** → the event trigger treats
  those functions as already handled and skips them → every function a
  future migration creates stays anon-executable. That is precisely the
  hole F016i was built to close, reopened through its own state.
- **Anon deletes rows** → the next `create or replace` of an existing
  function is treated as first sight and strips a live function's
  grants.

## What this is an instance of

F016i's fix was correct and its test was good — the catalog test even
caught a bug in the event trigger's own grants on its first run. What
neither covered was the **new object the fix introduced**. The feature
audited functions, because functions were the subject; the table it
created to do that audit was not itself in scope of anything.

Worth stating because M4 and M5 will add tables of their own, and the
question "what did this change add that nothing is now checking?" is not
one any of this mission's four review rounds has asked systematically.

## Scope

1. Enable RLS on the table, revoke from `anon` and `authenticated`. It
   is internal bookkeeping for a postgres-owned event trigger; nothing
   outside the owner should read or write it.
2. **A catalog test asserting there is no RLS-less table in `public`**,
   derived from `pg_class`/`pg_policy` rather than a list of names —
   the same shape as F016i's own function test, which is what made that
   one useful.
3. Check whether anything else this mission created is an object no test
   covers: tables, views, sequences, types. Say what you checked in the
   handoff, and be honest about the boundary of that claim rather than
   asserting completeness.

## Definition of done

- **Primary success test:** an anon-key insert, update, delete and
  select against the table are all rejected, proven over the wire as the
  reviewer proved the hole.
- **Failure test:** the event trigger still works — create a throwaway
  function in a rolled-back transaction and confirm it is revoked.
- **Manual verification:** the catalog test fails if RLS is disabled on
  any public table.
- **Side-effect verification:** F016i's and F016j's suites pass.
