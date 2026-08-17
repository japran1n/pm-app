# F097: onboarding membership gate

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F013
**Parent:** F013

## Assertion IDs covered
- AS-005

## Draft scope
- scrutiny-validator found app/(workspace)/onboarding/page.tsx has no membership check of its own — reachable unconditionally by any authenticated user at any time, including one who already has workspaces, which doesn't match AS-005's literal "no existing workspace membership" condition.
- Decide and implement: either (a) add a server-side check redirecting a user who already has an active membership to their default workspace instead of showing the onboarding form, or (b) if "create an additional workspace" is intentionally in scope (a user with one workspace should be able to make another), document that explicitly as a deliberate interpretation and adjust understanding accordingly — but do NOT silently leave the ambiguity unresolved. Default recommendation: implement (a), since AS-005's wording is specific ("no existing workspace membership") and multi-workspace creation isn't otherwise a stated v1 requirement outside the switcher (which only lists existing memberships, not a "create new" affordance yet).
- Add a test proving a user WITH an existing active membership visiting /onboarding directly is redirected, not shown the form.

## Files (approximate)
app/(workspace)/onboarding/page.tsx, tests

## Notes for clarification
Source: M2-scrutiny.md, "follow-up-onboarding-membership-gate". Severity: major.
