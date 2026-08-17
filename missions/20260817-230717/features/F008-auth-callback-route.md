# F008: auth callback route

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 20 minutes
**Depends on:** F007

## Assertion IDs covered
- AS-003

## Draft scope
- /auth/callback route handler exchanges the magic-link code for a session
- Redirects to the user's default workspace, or onboarding if none

## Files (approximate)
app/(auth)/auth/callback/route.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
