# F013: onboarding create workspace

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F012

## Assertion IDs covered
- AS-005
- AS-006

## Draft scope
- /onboarding route: create-first-workspace form, shown when user has zero memberships
- Creating a workspace inserts an 'owner' membership row for the creator

## Files (approximate)
app/(workspace)/onboarding/page.tsx, lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
