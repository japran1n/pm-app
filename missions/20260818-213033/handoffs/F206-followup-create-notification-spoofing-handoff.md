# Handoff: F206 follow-up — close notification spoofing gap in create_notification()

## Status
COMPLETE

## Assertions covered
AS-389: PASS — `tests/integration/rls-notifications.test.ts` (11/11 passing, run in isolation against the real linked Supabase project). This follow-up strengthens AS-389 ("a user reads only their own notifications") by also closing the corresponding write-side gap: added two new negative tests proving (a) a caller with no membership in the target workspace cannot create a notification there via the RPC at all, and (b) a workspace member cannot spoof an arbitrary `actor_id` — the resulting row's `actor_id` is forced to their own `auth.uid()` regardless of what `p_actor_id` they pass.

## Files changed
supabase/migrations/20260823030000_fix_create_notification_spoofing.sql
tests/integration/rls-notifications.test.ts

## Commands run
`npx supabase db push --linked` (0) — applied 20260823030000_fix_create_notification_spoofing.sql to the live linked Supabase project
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings only)
`npx vitest run tests/integration/rls-notifications.test.ts` (0) — 11/11 passed, run in isolation
`npm test` (0 exit from the pipe, but see Notes — see below for why this is not evidence of a regression)
`git commit` (0) — commit 86b7602

## Decisions made
- Used `drop function if exists ... ; create function ...` instead of `create or replace function`, because adding a trailing `p_system boolean default false` parameter changes the function's signature. `create or replace` with a changed signature creates a NEW overload and silently leaves the old, vulnerable 7-argument version still callable — the task brief explicitly warned about this and asked me to follow the mission's established drop+create convention for signature-incompatible changes, which I did.
- Mirrored `public.write_task_activity_entry()`'s exact `p_system` pattern (from `20260822230000_create_task_activity.sql`) rather than inventing a new shape, per the task's explicit precedent pointer: non-system calls require `auth.uid() is not null`, pin the actor to `auth.uid()`, and are additionally required here to be an active member of `p_workspace_id` (the extra caller-membership check, beyond what `write_task_activity_entry` needs, because a notification write is about *workspace* activity, not resource visibility per se — this is the "since a notification about workspace activity should only be raiseable by someone who is actually part of that workspace" requirement from the task).
- Kept the original recipient-membership check (`p_user_id` must be an active member of `p_workspace_id`) unchanged — it was already correct and is orthogonal to the caller-identity gap being closed here.
- For `p_system = true` calls, `actor_id` is forced to `null` and both the `auth.uid()`-not-null check and the caller-membership check are skipped, exactly matching `write_task_activity_entry`'s exemption for the recurrence job — intended for a future F212 cron/reminder job with no user session.
- Updated the two `adminClient.rpc("create_notification", ...)` seed calls in the existing test file to pass `p_system: true`, since the service-role admin client has no `auth.uid()` session either (it's not an `authenticated`-role session) and would otherwise trip the new "no authenticated caller" check when seeding fixture data.
- Did not touch F206's original migration file (`20260823020000_create_notifications.sql`) — per this mission's convention, already-applied migrations are not edited in place; the fix lands as a new, separately timestamped migration that supersedes the vulnerable function definition.

## Out-of-scope work needed
- F207 (server-side fan-out helper) still needs to be built; it can now call `create_notification()` as an authenticated actor on behalf of the current user (actor is auto-pinned) or, once a cron-style job exists (F212), pass `p_system: true`. No code changes needed in F207 to accommodate this fix beyond not attempting to pass a spoofed `p_actor_id` (which will now be silently ignored anyway).
- The Supabase project hit `AuthApiError: Request rate limit reached` (HTTP 429) during one of the full-suite `npm test` runs in this session — this is an auth-user-creation rate limit on the Supabase Auth admin API, not a code defect, and was caused by running the full test suite back-to-back multiple times in the same session (each integration test file creates several `auth.admin.createUser` fixtures). Not actionable as a code fix; a future infra follow-up could add a shared/reused fixture-user pool across integration test files to reduce Auth API call volume, but that is unrelated to this security fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `drop function` + `create function` over `create or replace function` because the signature changed (new trailing parameter) — this is the safer choice that actually removes the vulnerable old overload, per the task's own guidance and this mission's established convention.
AUTONOMOUS_DECISION: Ran the isolated `rls-notifications.test.ts` suite as the authoritative pass/fail signal for this fix rather than the full `npm test` run, because three back-to-back full-suite runs in this same session (one launched by me, plus background artifacts from a prior session) exhausted the Supabase Auth rate limit and caused ~40-50 unrelated test files (invite-member, transfer-ownership, dependency-ui-actions, workspace-role-expansion, etc. — none touching notifications) to fail with 30s timeouts or explicit `AuthApiError: Request rate limit reached (429)` errors. These are pre-existing integration tests unrelated to `create_notification()`; I confirmed `rls-notifications.test.ts` itself was not among the failures in either full run, and it passes 11/11 cleanly when run alone. Typecheck and lint are both clean.

## Notes for the next worker
- The live Supabase project now has the fixed `create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean)` function (8 args); the old 7-arg overload has been dropped, not left dangling.
- If you add a new notification-producing feature (F207-F212), remember: never pass `p_actor_id` expecting it to be honored for a normal (non-system) call — it is silently ignored and replaced with `auth.uid()`. Only use `p_system: true` from genuinely session-less service-role/cron contexts.
- No MCP tools were needed for this fix beyond the standard `supabase db push --linked` CLI flow already used by prior migrations in this mission (Supabase MCP is registered per `mcp-registry.md` but schema/RLS changes in this codebase are applied via the CLI + migration files, consistent with F206 and F194's own approach).
