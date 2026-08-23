# Handoff: F307 — M15 scrutiny follow-up: preferences UI reconciliation (AS-391) + AS-396 bookkeeping

## Status
COMPLETE

## Assertions covered
AS-391: PASS — `task_due_soon` is now a real, exhaustively-typed, consultable kind through the shared `IN_APP_COLUMN_BY_KIND` filter path (lib/notifications/preferences.ts), documented as sharing the exact `task_due_soon_in_app` column with F212's SQL sweep rather than diverging. The 5 email toggles + `email_enabled` master switch are hidden behind `EMAIL_NOTIFICATIONS_ENABLED = false` in preferences-form.tsx (no more controls that silently do nothing). Added 3 new real-Supabase gating tests (mention, comment_reply, watcher_update) alongside the existing task_assigned test — 5/5 passing in `notification-preferences-fanout.test.ts`.
AS-396: BLOCKED (bookkeeping, not a code defect) — recorded explicitly in `missions/20260818-213033/run-log.md` as BLOCKED-on-F213-F217. No email sender exists in this mission (F213-F217 deliberately [SKIPPED]), so "a user turns email off and receives none" is structurally unprovable — "receives none" is vacuously true under any setting. The existing round-trip persistence test is left untouched (legitimate but incomplete coverage). This assertion cannot be marked green until the email chain lands.

## Files changed
lib/notifications/fanout.ts
lib/notifications/preferences.ts
components/notifications/preferences-form.tsx
tests/integration/notification-preferences-fanout.test.ts
supabase/migrations/20260823090000_document_shared_task_due_soon_column.sql
missions/20260818-213033/run-log.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings)
`npx vitest run tests/unit/notification-preferences-filter.test.ts tests/integration/rls-notification-preferences.test.ts tests/integration/notification-preferences-fanout.test.ts tests/unit/notification-fanout.test.ts tests/integration/notification-fanout.test.ts` (0; 1 file had a transient "JWT issued at future" clock-skew failure on first combined run)
`npx vitest run tests/integration/notification-fanout.test.ts` (0, re-run alone: 2/2 passing, confirming the above was transient not a regression)
`npx vitest run tests/integration/notification-preferences-fanout.test.ts` (0, 5/5 passing including the 3 new gating tests)
`npx vitest run` (0 exit code; 38 pre-existing unrelated failures across the suite — invite/email/rate-limit live-Supabase flakiness and one unrelated Next.js `cookies()`-outside-request-scope error in a user-avatar test; none touching notifications/preferences files)

## Decisions made
- Added `task_due_soon` to `lib/notifications/fanout.ts`'s `NotificationKind` union rather than creating a second parallel map, so `IN_APP_COLUMN_BY_KIND` (a `Record<NotificationKind, ...>`) becomes exhaustive and a future TS caller can't forget this kind — matches the file's own existing "compile error, not silent bug" design intent.
- Did NOT attempt to make F212's SQL sweep literally call into the shared TypeScript map — that boundary has no TS runtime (pure pg_cron/plpgsql). Instead confirmed and documented (in a new documentation-only migration, `20260823090000_document_shared_task_due_soon_column.sql`, via `comment on column`) that both call sites read the exact same `task_due_soon_in_app` column, which is the realistic form of "one shared source of truth" across a SQL/TS boundary, per the spec's own guidance.
- Hid rather than removed the email UI (`EMAIL_NOTIFICATIONS_ENABLED = false` constant in preferences-form.tsx) — schema, migration, and any already-persisted `*_email`/`email_enabled` values are untouched. Re-enabling once F213-F217 ship is a one-line flag flip (documented inline in the component).
- Added the 3 new gating tests to the existing `notification-preferences-fanout.test.ts` file (matching its established real-Supabase pattern) rather than creating a new file, since they're the same suite/setup, just three more kinds.
- AS-396 fix is bookkeeping-only, recorded in `run-log.md` (this mission's actual tracking file — `validation-contract.md` is immutable and was correctly left untouched) rather than weakening the existing round-trip test, per instruction.

## Out-of-scope work needed
- F213-F217 (email sending chain, Resend integration) remain [SKIPPED] — once they land, AS-396 needs real re-validation (a test that actually drives an email send attempt and asserts it's suppressed when `email_enabled = false`), and `EMAIL_NOTIFICATIONS_ENABLED` in preferences-form.tsx should be flipped to `true`.
- No other out-of-scope items surfaced.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a feature-flag hide (not deletion) for the email UI controls, since the spec explicitly said "hide (or disable)... Do NOT delete the underlying schema columns/data" — this was the more conservative of the two allowed options and requires the least future rework.
AUTONOMOUS_DECISION: Used a documentation-only migration (`comment on column`) rather than attempting a functional code unification across the SQL/pg_cron vs. TypeScript boundary, since the spec itself acknowledged "a full 'one shared implementation' fix... isn't really possible without a bigger refactor" and asked for the column-name-honored-on-both-sides documentation as the realistic close-out.

## Notes for the next worker
- `lib/notifications/preferences.ts`'s `filterRecipientsByInAppPreference` now selects `task_due_soon_in_app` in its query too, even though no current call site passes a `task_due_soon` recipient through this function (F212's sweep gates in-line SQL instead) — this is intentional future-proofing per the spec, not dead code to be removed.
- The scrutiny report's exact wording ("shipping controls that silently do nothing is worse than not shipping them") is preserved verbatim in the code comment above `EMAIL_NOTIFICATIONS_ENABLED` for context continuity.
- No MCP tools were used for this feature — this was TypeScript/React logic reconciliation plus one documentation-only SQL migration; no live schema introspection or remote config verification was needed beyond what F211/F212's own migrations already established (grep-confirmed, not re-verified via Supabase MCP).
