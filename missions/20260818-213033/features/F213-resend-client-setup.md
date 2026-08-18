# F213: Resend client and send wrapper

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F118

## Assertion IDs covered
- AS-401: a failed send is logged and retried and never fails the user's action
- AS-402: no email is sent to an address that has not signed in to the workspace

## Draft scope
- `lib/email/client.ts`: server-only Resend client reading `RESEND_API_KEY`, never imported into a client component.
- `sendEmail()` wrapper: recipient eligibility check (active member with a confirmed sign-in), try/catch that logs and enqueues a retry, and a hard rule of never throwing into the caller.
- Retry store: a small `email_outbox` table with attempts and last_error, drained by a cron job.

## Files (approximate)
lib/email/client.ts (new), lib/email/send.ts (new), supabase/migrations/ (email_outbox + cron)

## Notes for clarification
- Whether to send synchronously first and only queue on failure, or always queue, changes the latency profile — decide explicitly.
- MCP at run: Supabase MCP for the outbox table.
