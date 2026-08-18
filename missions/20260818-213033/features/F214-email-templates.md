# F214: React Email templates

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F213

## Assertion IDs covered
- AS-395: every email links to the task and to notification preferences

## Draft scope
- Templates for assignment, mention, and daily digest built with `@react-email/components`, sharing one layout with the workspace name, a primary action button, and a footer holding the preferences/unsubscribe link.
- Plain-text alternative generated for each.
- Rendered snapshots tested so a template change cannot silently break the layout.

## Files (approximate)
lib/email/templates/*.tsx (new), tests/unit/email-templates.test.tsx (new)

## Notes for clarification
- The preferences link needs a signed, non-guessable URL if it is to work without a session — decide whether unsubscribe requires sign-in.
- MCP at run: none.
