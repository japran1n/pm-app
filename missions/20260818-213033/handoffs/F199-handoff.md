# Handoff: F199 — comment_reactions table + RLS

## Status
COMPLETE

## Assertions covered
AS-365: PASS — `test_AS_365_a_member_can_add_an_emoji_reaction_to_a_comment_on_a_task_they_can_see` inserts a real reaction via a real signed-in member session against the live linked Supabase project and reads it back; negative companions also pass: `test_AS_365_negative_emoji_outside_the_allow_list_is_rejected_by_the_CHECK_constraint`, `test_AS_365_negative_a_user_cannot_insert_a_reaction_row_claiming_another_users_id`, `test_AS_365_negative_an_outsider_who_cannot_see_the_task_cannot_react_to_its_comment`.
AS-368: PASS — `test_AS_368_a_duplicate_reaction_same_emoji_same_comment_same_user_is_rejected_by_the_primary_key` inserts the same (comment_id, user_id, emoji) tuple twice and asserts the second insert fails with Postgres error code 23505 (unique_violation on the PK), not an app-layer assumption. `test_AS_368_negative_a_different_emoji_from_the_same_user_on_the_same_comment_is_allowed` confirms the PK is scoped correctly (doesn't over-restrict).
AS-370: PASS — `test_AS_370_hard_deleting_a_comment_cascades_to_remove_its_reactions` inserts a reaction, hard-deletes the parent comment via the admin client, and asserts the reaction row is gone afterward (FK ON DELETE CASCADE).

## Files changed
supabase/migrations/20260823010000_create_comment_reactions.sql
lib/supabase/database.types.ts
tests/integration/comment-reactions-schema.test.ts

## Commands run
`supabase migration list --linked` (0) — confirmed local/remote in sync before writing a new migration
`supabase db push --linked` (0) — applied 20260823010000_create_comment_reactions.sql to the live linked project
`supabase gen types typescript --linked` (0) — regenerated database.types.ts
`npx vitest run tests/integration/comment-reactions-schema.test.ts` (0) — 7/7 new tests pass
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings (search.ts, invite-member-pagination.test.ts)
`npm run test` (0 process exit, but with pre-existing unrelated failures — see Notes below) — 1441 passed, 20 failed, 52 skipped across the full suite; all 20 failures are pre-existing Supabase Auth "Request rate limit reached" sign-in errors and timeouts in unrelated features (F013, F015, F019, F028, F038, F069, F072, F076, F108, F110, F126, F128, F152, F154, F163, F173, F174, F186, F188, F196), triggered by running the full integration suite's many real signInWithPassword calls back-to-back against the live Supabase project. None reference comment_reactions or F199. This is a known, previously-documented environmental issue (see e.g. F195/F292/F293/F294/F297 handoffs, which also completed with this same pre-existing flakiness present and unrelated to their own features).

## Decisions made
- **Emoji allow-list**: no exact list was specified in the clarification, so I chose a common minimal reaction set matching the spec's own example — 👍 ❤️ 😄 🎉 👀 🚀 — stored as the literal emoji characters directly in the CHECK constraint (no separate name<->emoji mapping table, no new dependency).
- **Soft-delete vs hard-delete for AS-370** (the clarification's own open question, resolved per its "take the simpler option, no new dependency, no second source of truth" instruction): `ON DELETE CASCADE` handles a HARD delete of a comment structurally. Comments are normally soft-deleted (`comments.deleted_at`), which does NOT fire the FK cascade — reaction rows for a soft-deleted comment are left in the table but become unreadable through the same `is_task_visible_to`/`comments_select_active_members` visibility path the comment itself already uses (the existing `comments_select_active_members` policy already hides `deleted_at is not null` rows). I deliberately did not add a trigger or a second cleanup path for soft-delete — that would be a second source of truth for "is this comment gone" duplicating logic the comments table already owns. AS-370's wording ("reactions are removed with their comment") is satisfied for the actual removal path (hard delete/purge, e.g. F220's purge job) that the assertion is about.
- **RLS helper reuse**: per the assignment's explicit instruction, reused `public.is_task_visible_to(task_id)` from F132 (via a join `comment_reactions -> comments -> task_id`) rather than reusing `comments`' own `is_task_workspace_member` helper or inventing a new predicate — this matches the shared-helper convention F163's task_watchers and F194's task_activity already established for tables one join level below tasks.
- **Write policy shape**: mirrored task_watchers' self-only INSERT/DELETE pattern (`user_id = auth.uid()`) rather than a general "any visible-task member may write any row" policy, since the spec explicitly says nobody may react on someone else's behalf. DELETE does not re-check task visibility (only ownership) — same reasoning as task_watchers_delete_self: if a row exists and belongs to the caller, they may remove it regardless of whether their access to the task later changed.
- **Primary key over surrogate id**: no `id uuid` column was added; the composite PK (comment_id, user_id, emoji) is both the identity and the invariant enforcer for AS-368, avoiding a redundant UNIQUE constraint alongside a separate PK.

## Out-of-scope work needed
- No Server Action layer, Zod schema, or UI exists yet for reactions (add/remove/toggle, emoji picker, reaction pills on comments) — that is explicitly F200/F201/F202's scope per the milestone plan, not this feature's. This migration only builds the table/RLS/publication plumbing those features will read/write through.
- F202 (live reactions) will need to subscribe to the `comment_reactions` Realtime channel; the table is now a member of the `supabase_realtime` publication so the plumbing is ready, but no subscriber code was added here (out of scope for a db-schema feature).
- The pre-existing Supabase Auth rate-limit flakiness across ~20 unrelated integration test files (documented above) is an environmental issue in the shared test-run pattern (many real `signInWithPassword` calls in one process), not something this feature introduced or is positioned to fix; it has already been noted in several prior handoffs (F195, F292–F294, F297) and is not re-litigated here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the emoji allow-list (👍 ❤️ 😄 🎉 👀 🚀) since neither the feature spec nor the clarification named an exact set, only "pick a reasonable common reaction set — 👍 ❤️ 😄 🎉 👀 🚀 or similar." Used the exact set from the assignment's own suggestion verbatim, since it's already a reasonable common-reaction set and adding/removing from it would be an arbitrary choice with no stronger signal available.

## Notes for the next worker
- MCP was not used for this feature; the Supabase CLI (`supabase migration list --linked`, `supabase db push --linked`, `supabase gen types typescript --linked`) was used directly per the assignment's explicit PRE-FLIGHT instruction ("CLI connectivity reliable this session"), consistent with how prior schema features (F163, F194) in this mission were built.
- `supabase db push --linked` printed three harmless NOTICEs ("policy ... does not exist, skipping") from the `drop policy if exists` guards inside the new migration — expected on first apply, not an error.
- If a future worker sees the same ~20-file Supabase Auth rate-limit failures when running `npm run test`, re-running the specific failing file(s) in isolation (as done here for `comment-reactions-schema.test.ts`) is the fastest way to confirm whether a given feature's own tests are actually green; the full-suite run is known to trip Supabase's sign-in rate limit when many integration files run back-to-back in one process.
