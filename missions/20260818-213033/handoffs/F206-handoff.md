# Handoff: F206 — notifications table + RLS

## Status
COMPLETE

## Assertions covered
AS-389: PASS — a user reads only their own notifications. Proven via 6 tests in `tests/integration/rls-notifications.test.ts`: owner reads their own row; another workspace member (RLS) sees zero rows; a total outsider (no membership) sees zero rows; a client cannot INSERT directly (no INSERT policy for `authenticated`, only the SECURITY DEFINER RPC); a forged-recipient RPC call still cannot be READ back by the caller's own session; owner can UPDATE (mark read) their own row; a different member's UPDATE attempt affects zero rows.
AS-392: PASS — notifications past the retention window are not shown. Proven via 2 tests: a notification admin-backdated to 31 days old is invisible to its own owner's session (RLS SELECT policy filters `created_at >= now() - interval '30 days'`) while still physically present when read via the service-role admin client (confirms "hidden", not "deleted"); a fresh notification within the window remains visible.

## Files changed
supabase/migrations/20260823020000_create_notifications.sql
lib/supabase/database.types.ts
tests/integration/rls-notifications.test.ts

## Commands run
`supabase db push --linked` (0) — applied the migration to the live linked project (qcipqonnqajmazdbysow)
`supabase gen types typescript --linked` (0) — confirmed `notifications` table live with expected columns/FKs, then regenerated `lib/supabase/database.types.ts`
`npx vitest run tests/integration/rls-notifications.test.ts` (0) — 9/9 passing standalone
`npm run test` (0, with pre-existing flaky failures unrelated to this feature — see Decisions made)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)

## Decisions made
- Followed F194 (`task_activity`)'s exact SECURITY DEFINER write pattern: `public.create_notification()` is the only INSERT path; the `notifications` table itself grants no client-side INSERT policy at all, so no session can fabricate a notification.
- **Retention (AS-392), per the clarified "ambiguity resolution" answer — simplest option, no new dependency, no second source of truth:** implemented as a fixed 30-day constant inlined directly into the SELECT policy's `using` clause (`created_at >= now() - interval '30 days'`), not a separate cron/delete job. This makes "not shown" a real DB-enforced guarantee across every query path, not a convention the UI has to remember. No hard-deletion job was added in this feature (see Out-of-scope below).
- SELECT/UPDATE access control is `user_id = auth.uid()` only — deliberately NOT routed through the shared `workspace_members`/`is_task_visible_to` helpers used by other F19x/F13x tables, because notification visibility here is genuinely per-recipient, not per-shared-resource; using the shared workspace helper would have been the wrong scope (it would let any workspace member read anyone's notifications). `workspace_id` is still stored (denormalised) for cheap per-workspace UI grouping, and IS validated against `workspace_members` (active status) inside `create_notification()` at write time.
- `kind` is a closed CHECK vocabulary (`mention`, `comment_reply`, `task_assigned`, `task_due_soon`, `watcher_update`) anticipating F207-F212's producers, mirroring `task_activity.kind`'s precedent of a small fixed set rendered by known UI templates.
- Added the table to the `supabase_realtime` publication in this same migration (guarded/idempotent, same pattern as `comment_reactions`/`comments`), per this feature's explicit note for F209.
- Verified live schema via `supabase gen types typescript --linked` (grepped for `notifications`) both before and after committing — this is the CLI-first path the registry marks primary; the Supabase MCP server itself is listed "Pending approval" in this environment, so no MCP tool calls were made (registry explicitly says never block a feature on MCP approval).

## Out-of-scope work needed
- No hard-deletion/cron cleanup job for notifications older than the retention window exists yet — rows simply age out of visibility via the SELECT policy. A future feature could add a `pg_cron` purge (mirroring F212's overdue-sweep pattern) for storage/compliance reasons if the mission later requires it; not needed for AS-392 as written (which is about visibility, not storage).
- No Server Action / UI layer yet (by design — this is F206, the pure schema+RLS feature; F207+ build the fan-out helper, panel UI, bell/badge, mark-read actions, and realtime wiring on top of this table).
- `create_notification()` does not itself verify that its caller (when invoked by an authenticated client rather than a server-side action) is entitled to notify the given `p_user_id`/`p_actor_id` pairing beyond "recipient is an active workspace member" — per the clarified spec, "Notifications are written server-side only, by lib/notifications/, never by a client," so this authorization narrowing is intentionally the responsibility of F207's server-side fan-out helper, not this migration. Documented and tested in `test_AS_389_negative_a_user_cannot_forge_a_notification_for_another_user_via_the_RPC`, which proves the leak-proof property (the forger's own session still cannot read the row back) holds regardless.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose 30 days as the fixed retention-window constant. The spec's Notes-for-clarification left "N days" unspecified beyond "hide older than N days in the panel." 30 days was picked as a common, unsurprising default for a notification inbox (matches typical product conventions) with no additional dependency or config surface; if the mission later needs this to be configurable, that is new scope for a follow-up feature, not a silent addition here.

## Notes for the next worker
- The `notifications` table and `public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb)` RPC are live on the linked Supabase project (qcipqonnqajmazdbysow) and in `lib/supabase/database.types.ts`. F207's fan-out helper (`lib/notifications/`) should call `create_notification` server-side (via the secret-key/admin client or an authenticated server action context), not insert directly.
- The Supabase MCP server (`mcp__supabase__*`) was still "Pending approval" in `claude mcp list` output during this session — same as the registry documented on 2026-08-18. All schema verification was done via the Supabase CLI (`supabase db push --linked`, `supabase gen types typescript --linked`), which the registry marks as the primary path regardless of MCP status.
- The full-suite run showed 18 failing tests across 78 files, all timeout/rate-limit flakiness in unrelated pre-existing tests (`workspace-role-expansion.test.ts`, `user-avatar.test.tsx`'s Next.js `cookies()`-outside-request-scope warning) — this exact flakiness class has been documented in `run-log.md` continuously since F127/F190/F201/F202/F205. No failing test references `notifications`. `tests/integration/rls-notifications.test.ts` passes 9/9 both standalone and as part of the full run.
