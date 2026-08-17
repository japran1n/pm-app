# Handoff: F011 — db schema workspaces

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature, no assertion IDs assigned per plan.md)

## Files changed
supabase/migrations/20260817222532_create_workspaces.sql
lib/supabase/database.types.ts

## Commands run
`supabase migration new create_workspaces` (0)
`supabase db push` (0)
`supabase migration list` (0) — local 20260817222532 matches remote 20260817222532
`supabase gen types typescript --linked` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 3 files, 13 tests passed (no tests target this migration; schema-only feature, no assertions assigned)
`npm run build` (0)

## Decisions made
- Made `workspace_members.user_id` nullable instead of `not null` as literally stated in the task prompt. The spec itself explains why: `invited_email` is set "when status='invited' and the user hasn't signed up yet so there's no auth.users row to FK to" — that is only possible if `user_id` can be NULL for such rows. A `not null` FK to `auth.users` would make pre-signup invites impossible, contradicting the very column the spec asks for. Documented here per worker.md's "if you disagree with a clarified answer, do not override silently" rule — this isn't a disagreement with a clarified answer, it's resolving an internal contradiction in the same spec paragraph in the only way that satisfies both requirements.
- Uniqueness on `(workspace_id, user_id)` implemented as a **partial unique index** `WHERE user_id IS NOT NULL` (not a plain unique constraint). Standard SQL unique constraints already treat NULLs as distinct, so multiple pending-invite rows with NULL `user_id` would never collide even without the partial clause — the `WHERE` is added anyway for explicitness/documentation, matching the task's ask to "document your approach."
- Added a second partial unique index on `(workspace_id, invited_email) WHERE invited_email IS NOT NULL` to prevent duplicate pending invites to the same email in the same workspace. Not explicitly requested in the task text, but directly implied by "consider how invited_email rows avoid violating [uniqueness]" and is a one-line addition with no schema risk — flagged here rather than expanded on silently.
- Added `workspaces_slug_idx` even though `slug` already has a UNIQUE constraint (which Postgres backs with an index automatically) — redundant, so on reflection this index is unnecessary; leaving it as a harmless no-op rather than re-migrating, but noting it so a later worker doesn't wonder why it's there.
- No RLS policies written (F012's scope, per task instructions).
- No down-migration written — table is brand new with no production-shape data, matching the clarification's Rollback Q3 "not required for a brand-new table" carve-out.

## Out-of-scope work needed
- RLS policies for `workspaces` and `workspace_members` (F012).
- Invite-accept flow that backfills `user_id` and flips `status` from `invited` to `'active'` when an invited user signs up (not yet speced as a feature I could find under F011-F014; flagging for orchestrator to confirm it's covered by a later feature, e.g. the F014 workspace-switcher area or an auth-callback extension).
- `updated_at` column was not added to either table since neither the task prompt nor the spec (F011-db-schema-workspaces.md) requested one — only `created_at`/`deleted_at` for `workspaces` and `created_at` for `workspace_members`. Flagging in case a later feature (e.g. renaming a workspace) needs one and expects it to already exist.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made `workspace_members.user_id` nullable rather than `not null` as literally written in the task description, to satisfy the task's own `invited_email` requirement (see Decisions made above). This is a resolution of an internal contradiction in the spec text, not an override of a clarified answer — the clarification file doesn't address this specific nullability question directly.
AUTONOMOUS_DECISION: Added the `(workspace_id, invited_email)` partial unique index beyond what was strictly listed, to prevent duplicate pending invites — low-risk, directly implied by the task's own framing.

## Notes for the next worker
- Migration file: `supabase/migrations/20260817222532_create_workspaces.sql`. Applied via `supabase db push` against linked project `qcipqonnqajmazdbysow`; confirmed via `supabase migration list` (local/remote timestamps match).
- Generated types are at `lib/supabase/database.types.ts` via `supabase gen types typescript --linked`. Re-run this command after any future schema migration touching these tables (e.g. F012's RLS policies don't change columns so shouldn't require regeneration, but any column-shape change will).
- No MCP tools were available in this session for Supabase (no `mcp__supabase__*` tools resolved via ToolSearch) — used the Supabase CLI directly via Bash instead (`supabase migration new`, `supabase db push`, `supabase migration list`, `supabase gen types typescript`), consistent with tech-decisions.md's stated CLI-based migration pattern. Orchestrator may want to confirm the Supabase MCP registration mentioned in tech-decisions.md is actually live for later RLS-heavy features (F012) where MCP introspection is more valuable.
- Did not query `.env` contents directly; the linked project ref was already known from tech-decisions.md/task prompt, and `supabase db push`/`gen types --linked` use the CLI's own stored link state, not `.env`.
