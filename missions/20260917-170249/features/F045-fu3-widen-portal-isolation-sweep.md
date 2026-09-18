# F045: FU-3 — widen the portal-isolation sweep to the whole tree

**Milestone:** M1 — Foundation (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F004

## Assertion IDs covered
- AS-008 (blocker fix)

## Clarified implementation
Inherited from F004's clarification (missions/20260917-170249/clarifications/F004-clarification.md).

## Follow-up scope (from M1-scrutiny.md)

Remove the `app/(portal)` filter from
`tests/unit/f004-webflow-tool-portal-isolation.test.ts` and scan all of
`app`/`components`/`lib` (the walk already collects them), keeping the
existing `"(workspace)"` directory exclusion (which correctly exempts the
legitimate route file). Exempt `components/nav/app-sidebar.tsx` by explicit
path with a comment, the same way `tests/unit/f009-legacy-portal-route-redirects.test.ts`
exempts its own legitimate files — **adopt F009's established, already-proven
pattern rather than the narrower one F004 used.**

Also:
- Fix the comment block at lines 45–51 of the current test, which claims the
  sweep covers "the shared components/lib the portal pulls from" when the
  code actually discards exactly those files.
- Make the `tools/webflow` path match use a literal forward slash on both
  sides of the comparison — `path.join()` produces backslashes on Windows,
  which would silently disarm the check on that platform.

## Definition of done
- Mutation-verified: temporarily add a Webflow-linking entry to
  `components/portal/portal-sidebar.tsx` and confirm the widened test goes
  red (it did not with the old, narrower scope — this is the exact
  regression AS-008 exists to catch).
- The widened sweep still passes on the current (correct) tree.
- Full non-integration suite still green.
