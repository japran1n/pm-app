# F292: authenticated task-creation endpoint

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F281

## Assertion IDs covered
- AS-558: submitting creates a real task visible on the board
- AS-561: the task is attributed to the reporter, not a service account
- AS-562: a submission without permission is rejected server-side
- AS-572: missing, expired, or mismatched tokens are rejected

## Draft scope
- ONE narrow Route Handler (`app/api/extension/tasks/route.ts`), not a general public API — the user cut a public API from this mission's scope.
- Authenticates with the caller's Supabase JWT from the Authorization header, resolves the user server-side, and ignores any user id in the payload.
- Re-verifies workspace/project membership, then creates the task through the same code path the web app uses so validation and defaults cannot drift.
- CORS restricted to the extension's origin; Zod-validated body.

## Files (approximate)
app/api/extension/tasks/route.ts (new), lib/validation/extension.ts (new), lib/actions/tasks.ts

## Notes for clarification
- Rate limiting was cut from this mission's scope; note the exposure in the handoff rather than silently adding it.
- MCP at run: Supabase MCP for verifying the RLS path.
