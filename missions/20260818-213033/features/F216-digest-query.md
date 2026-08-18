# F216: daily digest content

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F214

## Assertion IDs covered
- AS-397: the digest summarises due-today, overdue, and unread notifications
- AS-398: a user with nothing to report gets no digest

## Draft scope
- Query per user: tasks due today and overdue in their timezone, plus unread notification count, scoped to workspaces they are active in and excluding archived/trashed items.
- An empty result short-circuits before rendering or sending.
- Unit tests for the "nothing to report" boundary and the timezone bucketing.

## Files (approximate)
lib/email/digest.ts (new), supabase/migrations/ (digest RPC), tests/unit/digest.test.ts (new)

## Notes for clarification
- A user in several workspaces gets one digest with sections, not one email per workspace. Confirm.
- MCP at run: Supabase MCP.
