# F215: assignment and mention emails

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 30 minutes
**Depends on:** F214, F211

## Assertion IDs covered
- AS-393: assignment sends an email when enabled
- AS-394: a mention sends an email when enabled

## Draft scope
- Fan-out calls the email sender for recipients whose preferences enable that kind, after the in-app notification is written.
- Batching guard: several rapid changes to the same task for the same recipient collapse into one email within a short window.
- Integration test with the Resend client stubbed, asserting call count and recipient set.

## Files (approximate)
lib/notifications/fanout.ts, lib/email/send.ts, tests/integration/email-fanout.test.ts (new)

## Notes for clarification
- Tests must never hit the real Resend API; the client module needs a seam for injection.
- MCP at run: none.
