# F006f: A failed read must never render as a reassuring number

**Milestone:** M1 remediation, round 2
**Estimated worker time:** 2 h
**Depends on:** F006
**Opened by:** the M1 re-scrutiny

## The defect class

Two separate places swallow an error and then present a confident
figure computed from the resulting emptiness:

1. **`lib/queries/portal.ts:439-446`** logs a failed count and returns
   `count ?? 0`, which the portal renders as **"Nothing waiting on
   you"**. A dropped connection tells the client everything is fine.
2. **`getProjectPhases` (`portal.ts:302-317`)** logs a failed
   `project_statuses` read and then computes from an empty map: every
   task falls to `not_started`, so **every phase reports 0% with a
   correct-looking denominator**. A fully delivered phase reads as not
   started.

Both are the same mistake, and it is the worst one a client-facing
surface can make: a failure that looks like data. A blank screen makes
someone ask; a confident wrong number does not.

Also in scope, same root: **AS-002's two surfaces disagree.**
`page.tsx:111` feeds the project-scoped `badges.approvalsAwaiting` into
the tile, while the list below it is fed workspace-wide
`getPortalOverview(workspace.id)` with a `category !== 'done'` predicate
the tile does not apply. Two scopes and two predicates for one question.

## Assertion IDs covered
- AS-002: The sidebar shows a numeric badge on Approvals equal to the number of approval requests currently awaiting this client's decision.
- AS-011: A phase's progress figure counts only tasks that are marked visible to the client.

## Scope

1. Every portal read function returns a discriminated result — data or
   failure — rather than a fallback value. The portal renders an honest
   "we could not load this" state for the affected section and leaves
   the rest of the page working.
2. One query answers "what is waiting on this client", project-scoped,
   used by both the tile and the list. Delete the second predicate.
3. `getProjectPhases` fails loudly when its statuses read fails; it
   never computes a percentage from an empty map.
4. Fix the unit test that mocks a chain discarding its own `.eq()`
   arguments (`tests/unit/portal-phases-query.test.ts`) — a mock that
   ignores the filter cannot prove the filter is applied.

## Definition of done

- **Primary success test:** with the statuses read forced to fail, the
  phases section renders an error state and no percentage.
- **Failure test:** with the awaiting-count read forced to fail, the
  portal does not render "Nothing waiting on you".
- **Manual verification:** the tile and the list show the same number
  for a client on two projects.
- **Side-effect verification:** no portal query still returns a
  coalesced zero on error — grep for `?? 0` in lib/queries/portal.ts.
