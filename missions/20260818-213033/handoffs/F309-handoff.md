# Handoff: F309 — Close create_notification p_system authenticated-caller bypass

## Status
COMPLETE

## Assertions covered
AS-389: PASS — `tests/integration/rls-notifications.test.ts` (13/13 passing), including new tests `test_AS_389_negative_an_authenticated_caller_cannot_bypass_the_membership_check_by_claiming_p_system` (outsider session with `p_system => true` is now rejected) and `test_AS_389_the_service_role_admin_client_can_still_create_a_genuine_system_notification` (genuine no-session caller still works, actor_id null).

## Files changed
supabase/migrations/20260823100000_fix_create_notification_system_bypass.sql
tests/integration/rls-notifications.test.ts

## Commands run
`supabase db push --include-all` (0) — applied 20260823100000_fix_create_notification_system_bypass.sql
`supabase migration list --linked` (0) — confirms 20260823100000 applied remotely
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings
`npx vitest run tests/integration/rls-notifications.test.ts` (0) — 13/13 pass
`npx vitest run tests/integration/notification-mark-read.test.ts` (0) — 4/4 pass in isolation (transient "JWT issued at future" clock-skew flake when run in a larger batch, unrelated to this change; reproduced pass in isolation to confirm)
`npx vitest run` (0, but 43/251 files failed) — full-repo run against the live Supabase project; failures are pre-existing infra flakiness (Supabase auth rate-limiting from ~1700 tests hitting the live project in one run, plus one unrelated `cookies()`-outside-request-scope error from `user-avatar.test.tsx`/`comment-list.tsx`, and an `AS-238` workspace-invite test — none touch `create_notification`, notifications, or the migration in this feature). The notifications-specific suite (the regression check this feature's spec calls out as most important) passed cleanly on its own run.

## Decisions made
- Applied the exact same fix pattern already used for `write_task_activity_entry` (20260823060000): changed `if p_system then` to `if p_system and auth.uid() is null then`, so the system exemption only applies to callers with no real session at all.
- Used `create or replace function` (not `drop function`) since the signature is unchanged — same convention the write_task_activity_entry fix used.
- New migration timestamp is 20260823100000, not 20260823070000, because `supabase migration list --linked` showed 20260823070000 through 20260823090000 already exist (both locally and remotely) from other work merged into main since this feature's spec was written; used the next free slot after the latest existing migration.
- Confirmed via grep that the only `p_system => true` caller besides this feature's own new test is F212's overdue-sweep migration (SECURITY DEFINER, invoked by pg_cron as postgres — no user JWT — `auth.uid()` already null there) and the existing admin-client seed calls in `rls-notifications.test.ts`; both unaffected by this fix.

## Out-of-scope work needed
None identified specific to this feature. The pre-existing full-suite flakiness (Supabase auth rate-limiting under a ~1700-test run, `user-avatar.test.tsx` unhandled `cookies()`-outside-request-scope rejection, and the `AS-238` workspace-role-expansion invite test) is unrelated to `create_notification`/notifications and was already present before this change — not something this feature should fix, but worth flagging for a future test-infra hardening pass (e.g. throttling live-Supabase integration tests or running them in smaller batches in CI).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Renumbered the new migration's timestamp from the spec-implied 20260823070000 to 20260823100000 because that slot and the next two were already taken by unrelated migrations that landed in main after this feature's spec was authored; picked the next unused timestamp to avoid a collision, following the mission's chronological-migration-timestamp convention.

## Notes for the next worker
No MCP tools were used for this feature — schema/policy verification was done via `supabase db push` / `supabase migration list --linked` (Supabase CLI, not MCP) plus the live integration test suite, consistent with how the two precedent fixes (write_task_activity_entry, create_notification's original spoofing fix) were verified in this mission. The fix is a pure `create or replace function` body change; no RLS policy, grant, or table schema changed.
