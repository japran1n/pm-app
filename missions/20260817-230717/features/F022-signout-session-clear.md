# F022: signout session clear

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 15 minutes
**Depends on:** F006

## Assertion IDs covered
- AS-022

## Draft scope
- Sign-out action clears the Supabase session cookie fully; back-navigation shows no cached workspace data

## Files (approximate)
lib/actions/auth.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
