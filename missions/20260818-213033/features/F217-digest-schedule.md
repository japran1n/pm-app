# F217: digest scheduling

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F216, F213

## Assertion IDs covered
- AS-399: the digest is sent without anyone opening the app
- AS-400: it is sent at a time that respects the recipient's timezone

## Draft scope
- Hourly pg_cron job selecting users whose local time matches their configured digest hour and who have not received today's digest, then enqueueing sends through the outbox.
- Idempotency via a `last_digest_sent_on` date per user, so a re-run inside the same hour sends nothing.
- Registered in a migration, not the dashboard, with the schedule documented in the README (AS-529).

## Files (approximate)
supabase/migrations/ (function + cron.schedule), lib/email/digest.ts

## Notes for clarification
- If sending happens in Postgres via pg_net rather than in Next.js, the API key lives in Vault, not in a migration — settle this before writing SQL.
- MCP at run: Supabase MCP.
