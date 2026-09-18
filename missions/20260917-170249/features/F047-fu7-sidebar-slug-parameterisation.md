# F047: sidebar nav slug parameterisation

**Milestone:** M1 follow-ups
**Estimated worker time:** 20 minutes
**Depends on:** F044

## Assertion IDs covered
- AS-007

## Clarified implementation
(Inherited from F044)

## Follow-up scope (from M1-scrutiny-2.md — FU-7)
Wrap the existing render helper in `tests/unit/app-sidebar-webflow-nav.test.tsx`
in a `describe.each` over at least two distinct slugs (e.g. `acme` and `globex`)
and assert the href is `/w/${slug}/tools/webflow` in each, derived from the
fixture rather than written as a literal. The acceptance criterion is a mutation:
replacing `` `/w/${workspaceSlug}/tools/webflow` `` with a hardcoded
`"/w/acme/tools/webflow"` in `components/nav/app-sidebar.tsx` must turn the
suite red. While there, add a case that renders with a mocked membership object
carrying no Webflow flag, so a future default-on toggle cannot be introduced
invisibly.

## Definition of done
- **Primary success test:** `describe.each` over two slugs with href assertions derived from slug variable — mutation-verified
- **Failure test:** hardcoding href in source → test goes red
- **Manual verification:** none — automated suffices
- **Side-effect verification:** only `tests/unit/app-sidebar-webflow-nav.test.tsx` changes
- **Evidence artifact:** test output + mutation transcript in handoff
