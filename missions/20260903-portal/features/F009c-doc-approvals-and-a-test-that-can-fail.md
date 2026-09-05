# F009c: A doc approval you cannot open, and a test that cannot fail

**Milestone:** M2 remediation
**Estimated worker time:** 1.5 h
**Opened by:** the M2 gate

## The defects

1. **AS-021 fails for doc subjects.** `approval-card.tsx:56-67` yields
   `href = null` for a `subject_type = 'doc'` approval, so the card
   renders no "Open" control. The client is asked to approve something
   they cannot see. Meanwhile F008 dutifully uploads a snapshot of the
   doc body to a storage path that **zero code reads**.

   Two halves of one feature were built and never joined.

2. **AS-002's test cannot fail.** The predicate is genuinely fixed, but
   `tests/unit/portal-overview-queries.test.ts:82-93` discards the exact
   `.eq()` that makes it true and hand-sets `ownerRows = []`, while its
   comment claims it "proves the owner lookup is scoped by `user_id`".
   Delete `.eq("user_id", user.id)` from the source and the test ships
   green.

   This is the same shape as M1's round-3 finding, in the same file,
   moved one query to the left. F006j extracted
   `tests/unit/helpers/query-filter-mock.ts` precisely for this, and
   this test was not migrated to it.

## Assertion IDs covered
- AS-002: The sidebar shows a numeric badge on Approvals equal to the number of approval requests currently awaiting this client's decision.
- AS-021: The portal shows every open approval request for the client's projects, with what is being approved, who must decide, and its due date.

## Scope

1. Give a doc-subject approval a real "Open" control. Decide between
   rendering the snapshot F008 already stores and linking to a
   client-readable view of the doc itself, and say which and why — the
   snapshot is the honest thing to approve, since it is what the
   decision will be recorded against, but only if the client can
   actually read it.
2. If the snapshot stays unread by any code path after your change,
   remove the upload rather than leaving a write nothing consumes. Dead
   writes to storage are how a bucket becomes unauditable.
3. Migrate the AS-002 test to the shared query-filter helper so it
   observes the filter it claims to prove. Then delete
   `.eq("user_id", user.id)` locally, watch it fail, restore it, and say
   so in the handoff.
4. Check the other tests in that file for the same shape while you are
   there.

## Definition of done

- **Primary success test:** a doc-subject approval renders a control
  that opens something the client can actually read.
- **Failure test:** the AS-002 test fails when the user_id filter is
  removed from the query — demonstrated, not asserted.
- **Manual verification:** no storage write in the approvals flow is
  left with no reader.
- **Side-effect verification:** F008's and F009's tests pass; task and
  artifact subjects still render their controls.
