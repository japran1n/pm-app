# F044: FU-2 — make the sidebar assertions falsifiable

**Milestone:** M1 — Foundation (follow-up)
**Estimated worker time:** 30 minutes
**Depends on:** F003

## Assertion IDs covered
- AS-006 (blocker fix)
- AS-005 (major fix)
- AS-127 (major fix)

## Clarified implementation
Inherited from F003's clarification (missions/20260917-170249/clarifications/F003-clarification.md).

## Follow-up scope (from M1-scrutiny.md)

Rewrite `tests/unit/app-sidebar-webflow-nav.test.tsx` so each assertion can
actually fail:

- **AS-006**: assert a token unique to the ACTIVE branch (`font-medium`) AND
  `not.toContain("text-muted-foreground")` on the active render; add a
  negative case at pathname `/w/acme/projects` where the Webflow anchor
  carries neither `aria-current` nor the active classes; add a nested-path
  case at `/w/acme/tools/webflow/results` (still active).
- **AS-005**: parse the rendered nav into groups and assert the item appears
  in the unlabeled first group after Projects, with no group heading
  preceding it — not just `toContain("Webflow")`.
- **AS-127**: widen the match to include the icon element itself (the
  current regex only captures the `<a>` tag, missing the sibling `<Icon>`
  element) so a legibility regression on the icon would actually be caught.
- Assert BOTH rendered instances — the desktop `<aside>` and the mobile
  `<Sheet>` — today only the first anchor is matched, so a mobile-only
  regression is invisible.
- Add an `afterEach` restoring `vi.resetModules()`/`vi.doMock()` that the
  scrutiny report found left dangling after test 2.

## Definition of done
- Each rewritten assertion is mutation-verified: temporarily break the
  corresponding implementation detail (remove active class, move nav group,
  drop icon styling) and confirm the specific test goes red; document this
  in the handoff per assertion.
- Both desktop and mobile nav renders are covered.
- Full non-integration suite still green.
