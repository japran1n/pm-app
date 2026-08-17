# F061: delete comment action

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 25 minutes
**Depends on:** F059

## Assertion IDs covered
- AS-098
- AS-099
- AS-100

## Draft scope
- Server Action: author can delete own comment; admin/owner can delete any; others rejected server-side

## Files (approximate)
lib/actions/comments.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
