# F016: invite accept on signin

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F015

## Assertion IDs covered
- AS-008
- AS-009

## Draft scope
- On magic-link sign-in, if the email matches an invited row for a workspace, flip status to active
- Invited-but-not-yet-signed-in rows must not show as active anywhere

## Files (approximate)
app/(auth)/auth/callback/route.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
