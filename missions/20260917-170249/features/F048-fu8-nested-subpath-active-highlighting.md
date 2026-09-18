# F048: nested-subpath active highlighting coverage

**Milestone:** M1 follow-ups
**Estimated worker time:** 20 minutes
**Depends on:** F044

## Assertion IDs covered
- AS-006

## Clarified implementation
(Inherited from F044)

## Follow-up scope (from M1-scrutiny-2.md — FU-8)
Add the subpath case FU-2 specified and F044 skipped: set `currentPath` to
`/w/acme/tools/webflow/results` and assert the Webflow link carries
`aria-current="page"` and `font-medium`. Acceptance is mutation-verified:
adding `exact: true` to the Webflow nav entry, and separately collapsing the
`isActive` expression to `pathname === href`, must each turn this test red.
Additionally assert that Webflow's active class string is identical to another
top-level item's (e.g. Projects) so "the same active-route styling as other
sidebar items" is compared rather than assumed.

## Definition of done
- **Primary success test:** nested subpath case mutation-verified against `exact: true` and bare `===` mutations
- **Failure test:** both mutations produce red test
- **Manual verification:** none — automated suffices
- **Side-effect verification:** only `tests/unit/app-sidebar-webflow-nav.test.tsx` changes
- **Evidence artifact:** test output + mutation transcript in handoff
