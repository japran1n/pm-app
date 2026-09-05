# F016h: The sweep now never re-blocks, and two render paths have no tests

**Milestone:** M3 remediation
**Estimated worker time:** 2 h
**Opened by:** the M3 re-scrutiny

## Defect 1 — F016e over-corrected the sweep

Round 1 found the sweep re-blocking a task a human had deliberately
unblocked, every hour. F016e fixed that with `swept_at` — and went too
far: `swept_at` is never reset anywhere, and the sweep stamps **every**
overdue blocking deliverable on a task rather than only the one it acted
on.

So a task that should be re-blocked because a *second* deliverable went
overdue never will be. The hourly nag became permanent suppression, and
AS-030's guarantee — that an outstanding obligation keeps counting —
quietly stopped holding for any task that was ever swept once.

The correct semantics: the mark is per deliverable-task pair, not
per task; and it is cleared when the deliverable is accepted or its due
date moves, so the pair can legitimately block again.

## Defect 2 — AS-003 is fixed in the query and untested in the classifier

The `blocking` divergence is gone, but the badge and the view still
classify state independently and disagree on `delivered`.
`classifyBucket` has no tests at all: changing
`your-list/page.tsx:40` to `return "waiting";` keeps the whole suite
green.

## Defect 3 — AS-048's render path has no test

The RLS half is right and genuinely tested — the two-client test would
fail on a revert. But deleting `change-requests-table.tsx:112-115`
removes the estimate and the price from the client's view with the suite
still green. And `quoteStateLabel` has no branch for an expired quote,
so an expired one reads as if it were still open.

## Assertion IDs covered
- AS-003, AS-030, AS-048

## Scope

1. Make `swept_at` per pair and clear it on acceptance and on a due-date
   change. Test the second-deliverable case explicitly: a task swept for
   deliverable A must still be blockable by deliverable B.
2. Give `classifyBucket` tests that pin each state, including
   `delivered`, and make the badge and the view share the classifier
   rather than each having one.
3. Test the change-request table's rendering of estimate, price and
   state, and add the expired branch to `quoteStateLabel`.
4. For each test you add, check it can fail: change the source, watch
   it, revert. Say so in the handoff. Three tests in this mission have
   passed while asserting nothing.

## Definition of done

- **Primary success test:** a task swept for one overdue deliverable is
  still blocked when a second one goes overdue.
- **Failure tests:** breaking `classifyBucket`, or deleting the price
  cell, each fails a test.
- **Manual verification:** badge and view agree for a project with
  delivered-but-unaccepted items.
- **Side-effect verification:** F013, F014, F016 and F016e suites pass.
