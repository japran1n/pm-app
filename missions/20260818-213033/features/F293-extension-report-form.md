# F293: the report form

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F292

## Assertion IDs covered
- AS-555: pick workspace, project, and status
- AS-556: title, description, assignee, priority, due date
- AS-557: only options the user actually has access to are offered

## Draft scope
- Form in the popup, populated from endpoints scoped to the caller's memberships — never a client-side filter over a full list.
- Title required; everything else optional with sensible defaults.
- Status list comes from the project's own columns once M16's custom statuses land; until then the fixed four.

## Files (approximate)
extension/src/popup/report-form.tsx, app/api/extension/context/route.ts (new)

## Notes for clarification
- The context endpoint is a second, read-only route; keep it as narrow as F292 and reuse its auth.
- MCP at run: none.
