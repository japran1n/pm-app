# F016f: The INSERT hole, and two silent reverts

**Milestone:** M3 remediation — **blocker**
**Estimated worker time:** 2.5 h
**Opened by:** the M3 re-scrutiny

## Defect 1 — the guard is BEFORE UPDATE only

F016d pinned F016's thirteen triage and decision columns on
`client_requests` against author writes — with a `BEFORE UPDATE`
trigger. `client_requests_insert_own`'s `with check` pins **none** of
them.

So a client can `POST /client_requests` with
`client_decision = 'approved'` and defeat AS-047's acceptance gate
outright. They can also set `approval_request_id` to an existing pending
commercial approval and hijack the sync trigger into writing their own
text into `project_scope_items`.

This is the sixth appearance of the same class in this mission — a rule
applied on one path and absent on its sibling. F016d was the structural
answer for the RPCs and it worked; the INSERT path was simply never in
anyone's field of view, including mine when I wrote F016d's spec.

## Defect 2 — F016e reverted two earlier fixes

Both silent, both one migration after the fix they undid:

- `send_change_request_quote_atomic` was routed through `client_gate` by
  F016d and taken back off it by F016e.
- F016c added `and t.project_id = cd.project_id` to the sweep's join;
  F016e's rewrite of that function dropped the predicate **and kept
  F016c's comment claiming it is there.**

Neither is currently exploitable — the composite FK makes the second
unreachable — but a comment that lies about a security predicate is
worse than no comment, and a fix that survives one migration is not a
fix.

## Defect 3 — a stale failing test

`tests/integration/client-requests-rls.test.ts` fails against F016e's
intentional RLS widening. F016b found it while running its side-effect
suites. A known-failing test is noise that hides the next real failure,
which is exactly how the mission's first full-suite run took an hour to
interpret.

## Assertion IDs covered
- AS-047: A client request classified as a change request cannot become a task until the client has approved its quote, enforced inside the database function rather than in the UI.

## Scope

1. Pin the thirteen columns on INSERT as well as UPDATE. Prefer
   extending the existing trigger to `BEFORE INSERT OR UPDATE` over
   writing a second mechanism in the policy — one place, both verbs.
2. Restore `send_change_request_quote_atomic` to `client_gate`, and add
   whatever makes a future silent revert visible: at minimum a test that
   asserts the function's body calls the gate.
3. Restore the sweep's project predicate, or delete the comment if the
   composite FK genuinely makes it redundant — decide, and say which in
   the handoff. Do not leave the two disagreeing.
4. Update the stale test to F016e's intended behaviour, without
   weakening what it asserts.

## Definition of done

- **Primary success test:** a client POSTing a request with
  `client_decision = 'approved'` or a foreign `approval_request_id` is
  rejected, called directly through PostgREST.
- **Failure test:** a client can still create an ordinary request, and
  the team can still triage and quote it.
- **Manual verification:** the sweep's code and its comment agree.
- **Side-effect verification:** the client-requests suite passes rather
  than being known-failing.
