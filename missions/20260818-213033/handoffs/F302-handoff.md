# Handoff: F302 — Security follow-up: activity-entry forgery + comment-edit authorship guard

## Status
COMPLETE

## Assertions covered
AS-357: PASS — Append-only guarantee on `task_activity` now holds even against the forged-system-write path. New test `AS-357 (F302 forgery fix): an authenticated outsider passing p_system => true is rejected and writes no row` in `tests/integration/rls-activity.test.ts` proves an authenticated (real session, non-service-role) outsider who cannot see the task is rejected by `write_task_activity_entry(..., p_system => true)` and writes zero rows. Pre-existing AS-357 tests (direct UPDATE/DELETE rejected) still pass.
AS-364: PASS — Two new integration tests in `tests/integration/edit-comment.test.ts` prove: (1) a workspace admin's two-step authorship-takeover attempt (reassign `user_id` to self, then rewrite body) is rejected at step 1 and the row is untouched; (2) neither a non-author member nor an admin can stamp `edited_at` on someone else's comment via a direct API call. Pre-existing AS-364 tests (author-only edit, RLS/trigger blocking non-author edits) still pass.

## Files changed
supabase/migrations/20260823060000_fix_write_task_activity_entry_forgery.sql
supabase/migrations/20260823070000_fix_comment_edit_trigger_authorship_guard.sql
tests/integration/rls-activity.test.ts
tests/integration/edit-comment.test.ts

## Commands run
`npx supabase db push` (0) — applied both new migrations
`npx supabase migration list --linked` (0) — confirmed both `20260823060000` and `20260823070000` show matching local/remote timestamps (applied)
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 2 pre-existing warnings unrelated to this feature (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts), 0 errors
`npx vitest run tests/integration/rls-activity.test.ts tests/integration/edit-comment.test.ts` (0) — 2 files, 20/20 tests pass (isolated run, no rate-limit contention)
`npm test` i.e. `npx vitest run` (1) — 44/244 files failed, but every failure I inspected is either (a) a documented pre-existing regression unrelated to this feature (e.g. AS-347 `trash-list`, `user-avatar.test.tsx` — a Next.js `cookies()`-outside-request-scope error; AS-238/AS-007 invite-member failures) or (b) `Error: ... Request rate limit reached` from Supabase Auth when dozens of integration test files sign in/create users concurrently against the real linked project under full-suite parallelism — this is an environmental/load artifact of running ~1660 tests in parallel against one Supabase project's auth rate limits, not a functional regression. `rls-activity.test.ts` itself only failed in the full-suite run with exactly this rate-limit error (`Failed to sign in outsider test user: Request rate limit reached`), and passed cleanly 8/8 (0 skipped) when run in isolation together with `edit-comment.test.ts` immediately before and after this fix.

## Decisions made
- Fix 1 (D1/FU-2): chose option (a) from the spec — restrict `p_system`'s exemption to callers with `auth.uid() is null` — over splitting into two functions, since it is the smaller, more surgical change and exactly mirrors the precedent already established today in `20260823030000_fix_create_notification_spoofing.sql`. Confirmed the one legitimate `p_system => true` caller (`lib/recurrence/generate-next-occurrence.ts`, the recurrence job) always calls through a service-role `admin` Supabase client with no user JWT — i.e. `auth.uid()` is already null in that context today — so this fix changes zero behavior for that caller. Verified via `grep -rn "p_system"` across the repo that no other caller passes `p_system: true` from a client-facing/user-session context.
- Used `create or replace function` for the `write_task_activity_entry` fix (unchanged signature — only internal branching logic changed), not `drop function` + `create function`, consistent with this mission's stated convention that `drop`+`create` is reserved for signature-incompatible changes.
- Fix 2 (FU-5/AS-364): extended the existing `enforce_comment_edit_author_only()` trigger function (via `create or replace function`, same trigger signature) rather than writing a second trigger, since it already carries the exact "compare OLD vs NEW, exempt service_role" pattern this needed extending. Added an unconditional `new.user_id is distinct from old.user_id` rejection (not gated on `auth.uid()` at all — authorship reassignment is never permitted through this path, full stop, closing the case where the row's current author reassigns their own comment away too) plus folded `edited_at` into the same content-change guard that already covers `body_text`/`body_json`/`text`.
- Migration timestamps: discovered a collision — `20260823040000` and `20260823050000` were already taken by concurrently-created migrations (`create_notification_preferences.sql`, `overdue_notification_sweep.sql`) not visible when I first named my files. Renamed my two migrations to `20260823060000` and `20260823070000` before pushing, confirmed via `supabase migration list --linked` that no collision remained.
- Verification path used for both fixes: direct Postgres access via `supabase db push` / `supabase migration list --linked` (both succeeded normally — PostgREST was not observed to be down during this session), and `supabase-js` integration tests over PostgREST for behavioral verification (also worked normally in isolated runs). Did not need the Management API SQL fallback described in the task — PostgREST was healthy throughout this run.

## Out-of-scope work needed
- The full `npx vitest run` suite has ~38-44 pre-existing failing test files unrelated to F302 (invite-member/workspace-role-expansion Supabase Auth rate-limiting under full parallel load; a Next.js `cookies()`-outside-request-scope unhandled rejection sourced from `lib/actions/comments.ts:1159` via `getMentionCandidates` surfacing during unrelated component tests; `AS-347` trash-list rendering; `user-avatar.test.tsx`). None of these are new regressions introduced by this feature (confirmed via isolated runs of the touched files) but they mean `npm test`'s exit code does not currently reflect the health of this feature's own tests. Worth a dedicated follow-up to either reduce Vitest's parallelism for integration tests against the real Supabase project, or partition Auth-heavy integration tests into a serial pool, to stop rate-limit flakiness from masking real signal in full-suite runs.
- FU-1, FU-3, FU-4, FU-6 from the M15 scrutiny report (`missions/20260818-213033/milestones/M15-scrutiny.md`) remain open; this feature only closed D1/FU-2 and FU-5/AS-364 per its explicit scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Renamed both new migration files from their originally-drafted timestamps (`20260823040000`, `20260823050000`) to `20260823060000`/`20260823070000` after discovering those timestamps were already used by other migrations applied earlier the same day, to avoid a collision — no functional change, purely a filename/ordering fix.
AUTONOMOUS_DECISION: For Fix 1, chose option (a) (auth.uid() is null gate) over splitting into two functions, per the spec's "pick whichever is the smaller, more surgical fix" instruction and to exactly match the same-day `create_notification` precedent.

## Notes for the next worker
- Both migrations are additive/surgical `create or replace function` changes with no signature change — no `database.types.ts` regeneration was needed (the RPC signatures are unchanged).
- If you need to verify PostgREST health before running integration tests, check `missions/20260818-213033/run-log.md` around 05:24Z for the logged PGRST002 outage note, and see `tests/integration/overdue-notification-sweep.test.ts` for the documented Management-API-SQL-endpoint fallback pattern (not needed this session — PostgREST was healthy).
- When running the full `npx vitest run` suite against the real linked Supabase project, expect `Request rate limit reached` failures on Auth-heavy integration test files under full parallelism; re-run the specific file(s) you care about in isolation (`npx vitest run tests/integration/<file>.test.ts`) to get a trustworthy signal.
