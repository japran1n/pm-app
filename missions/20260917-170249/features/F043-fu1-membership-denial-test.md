# F043: FU-1 — behavioural membership-denial test for the converter route

**Milestone:** M1 — Foundation (follow-up)
**Estimated worker time:** 25 minutes
**Depends on:** F002

## Assertion IDs covered
- AS-003 (blocker fix — M1 scrutiny report)
- AS-004 (strengthen — name it explicitly in a test)

## Clarified implementation
Inherited from F002's clarification (missions/20260917-170249/clarifications/F002-clarification.md) — engine/UI conventions unchanged.

## Follow-up scope (from M1-scrutiny.md)

Add a test that renders `WorkspaceLayout` with the converter page as
`children` and `params: Promise.resolve({ workspaceSlug: "not-mine" })`,
mocking `getCurrentUser` to return a user and `getWorkspaceBySlug` to return
`null`, asserting `notFound()` was called — use
`tests/integration/workspace-not-found-scope.test.ts` as the template.

**Acceptance criterion is a mutation test, not a green run**: deleting the
layout's `if (!activeWorkspace)` block must make this new test fail. Verify
this yourself (temporarily comment out the guard, confirm red, restore it,
confirm green) and say so explicitly in the handoff.

While there, add `expect(requiresAuth("/w/acme/tools/webflow")).toBe(true)`
to `tests/unit/proxy-auth-guard.test.ts` so AS-004 is named by a test
somewhere rather than only covered by construction.

## Definition of done
- The new test fails when the membership guard is deleted (mutation-verified, documented in handoff) and passes with it present.
- `requiresAuth("/w/acme/tools/webflow")` is asserted `true` somewhere in the suite.
- Full non-integration suite still green.
