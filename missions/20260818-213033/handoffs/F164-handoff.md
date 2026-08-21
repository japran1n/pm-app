# Handoff: F164 — watcher actions + auto-watch on comment

## Status
COMPLETE

## Assertions covered
AS-295: PASS — `tests/integration/watchers.test.ts` — "AS-295: watchTask adds a watcher row for the calling member" (self-serve path) and "AS-295 + AS-296: commenting adds a first-time watcher, but a comment AFTER an explicit unwatch does NOT re-add them" (auto-watch-on-comment path, first-comment half) both prove commenting/watching adds a watcher row with `is_watching: true`.
AS-296: PASS — `tests/integration/watchers.test.ts` — "AS-296: unwatchTask marks the caller's watcher row not-watching" proves unwatch flips `is_watching` to false; the same combined durability test above proves the negative case that gives AS-296 its teeth: a second comment by the same user, after an explicit `unwatchTask`, leaves `is_watching: false` untouched (does not silently re-add).

## Files changed
supabase/migrations/20260822053000_task_watchers_durable_unwatch.sql
lib/supabase/database.types.ts (task_watchers Row/Insert/Update — added `is_watching: boolean`)
lib/validation/watchers.ts (new)
lib/actions/watchers.ts (new — watchTask, unwatchTask)
lib/actions/comments.ts (addComment extended with auto-watch upsert)
tests/integration/watchers.test.ts (new)

## Commands run
`supabase migration list --linked` (0) — pre-flight connectivity check, returned promptly
`supabase db push --linked` (0) — applied `20260822053000_task_watchers_durable_unwatch.sql`
`supabase gen types typescript --linked` (0) — confirmed `is_watching: boolean` landed on `task_watchers`, merged only that field into `lib/supabase/database.types.ts` by diff (confirmed via `git diff` that no unrelated blocks were touched)
`npx vitest run tests/integration/watchers.test.ts` (0) — 6/6 passed
`npx vitest run tests/integration/add-comment.test.ts tests/integration/rls-task-watchers.test.ts` (0) — 11/11 passed (F163/F059 regression check)
`npx vitest run --no-file-parallelism tests/integration/watchers.test.ts tests/integration/add-comment.test.ts tests/integration/rls-task-watchers.test.ts tests/integration/rls-comments.test.ts` (0) — 25/25 passed, run serially to avoid Supabase Auth sign-in rate limiting
`npx tsc --noEmit` (0)
`npx eslint lib/actions/watchers.ts lib/actions/comments.ts lib/validation/watchers.ts tests/integration/watchers.test.ts` (0)
`npm run test` (nonzero — see Decisions made re: pre-existing rate-limit failures, none in my files)

## Decisions made
- **Durability-rule design (the core decision of this feature)**: chose to keep the `task_watchers` row on unwatch and add an additive `is_watching boolean not null default true` column, rather than deleting the row on unwatch. Reasoning: a delete-based unwatch is indistinguishable from "never watched" — a later `INSERT ... ON CONFLICT DO NOTHING` from the auto-watch-on-comment path would then insert a fresh row and silently resurrect the watcher, defeating the whole point of an explicit unwatch. By keeping the row and flipping a flag instead:
  - `watchTask` upserts `is_watching: true` (creates the row if absent, or re-enables an existing one — this is the *only* path that can turn an explicit opt-out back on, and it requires the user to explicitly act again, matching the spec's "re-adds them only if they have not explicitly unwatched since").
  - `unwatchTask` upserts `is_watching: false` (creates a row with `is_watching: false` even for someone who was never a watcher at all — clicking "stop watching" on a task always records a durable "no", so a future first comment on that task by that same user does not silently start watching them either; this generalizes the "no silent re-add" rule to the never-watched case too, which the spec doesn't explicitly rule on but is the more conservative and consistent reading of "explicit unwatch wins until the user acts again").
  - `addComment`'s auto-watch step becomes a plain `upsert(..., { onConflict: 'task_id,user_id', ignoreDuplicates: true })`, i.e. `INSERT ... ON CONFLICT DO NOTHING`. If no row exists, it inserts one with `is_watching: true` (first-time commenter gets auto-watched, AS-295). If a row already exists — watching or explicitly unwatched — the insert is a no-op, so the existing state (including an opt-out) survives untouched. This is exactly the "idempotent insert on comment" the spec asked for, while composing correctly with the flag-based opt-out.
  - Alternative considered and rejected: a second table (e.g. `task_watcher_optouts`) tracking explicit opt-outs separately from the watcher list. Rejected per the clarification's "simpler option, no second source of truth" default — a single boolean column on the existing table is strictly simpler and keeps one row per (task, user) as the single source of truth for "what does this user want for this task," rather than splitting that decision across two tables that could drift.
- **No SECURITY DEFINER trigger needed for auto-watch**: F163's handoff anticipated F164 would need a SECURITY DEFINER mechanism or the service-role client to write a watcher row "on behalf of" the commenter, since RLS's INSERT/UPDATE policies require `user_id = auth.uid()`. Confirmed `lib/actions/comments.ts`'s `addComment` already uses `createAdminClient()` (service role, bypasses RLS entirely) for its own insert and all its lookups — so the auto-watch upsert simply reuses that same already-held admin client for one more write. No new SECURITY DEFINER function or trigger was needed; this satisfies F163's own guidance ("service role" was one of the two acceptable options) with zero new schema surface beyond the `is_watching` column.
- **New RLS UPDATE policy required**: F163 only shipped SELECT/INSERT/DELETE self-serve policies. Since `watchTask`/`unwatchTask` now upsert (which needs UPDATE privileges on the conflict path, not just INSERT), added `task_watchers_update_self` (self-only, same `user_id = auth.uid()` predicate as the existing INSERT/DELETE policies) in the same additive migration. Existing F163 policies were left untouched, per the mission's additive-migration convention.
- **`watchTask`/`unwatchTask` do not gate on `canWrite`**: unlike `addComment`, watching is a personal notification preference, not a content mutation — a viewer (read-only role) should still be able to opt in/out of watching a task they can see. Only `requireActiveMembership` is re-checked server-side (defense in depth), matching the clarified "auth" answer's membership re-check without importing a write-content predicate that doesn't apply here.
- **Ambiguity resolution** (spec's own note: "the simplest coherent rule: auto-watch on comment, explicit unwatch wins until the user acts again"): implemented exactly as stated, per the clarification's default of taking the simpler option and recording the choice here.

## Out-of-scope work needed
- No UI wiring (a watch/unwatch toggle button in the task detail view) was added — the feature spec's "Files (approximate)" list only names the action/validation layer (`lib/actions/watchers.ts`, `lib/actions/comments.ts`, `lib/validation/watchers.ts`), matching F163's own out-of-scope note that the UI/action layer would land "alongside F164 or a dedicated watch-toggle feature." A future feature can call `watchTask`/`unwatchTask` directly from a task-detail component; both already return the discriminated-union shape (`{ ok, data: { taskId, isWatching } }`) a client component would need for optimistic UI.
- F207's notification fan-out (referenced in F163's own migration comments) should query `task_watchers` filtered on `is_watching = true` (not merely "row exists") — this is called out explicitly in the new migration's column comment so a future worker doesn't miss the distinction.
- F231 ("tasks I watch" in My Tasks) should likewise filter on `is_watching = true`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond the durability-rule design already recorded above under Decisions made, which was an explicitly delegated design call per the spec's own "decide the rule, then encode it" instruction — not a deviation from a given answer.)

## Notes for the next worker
- MCP: Supabase MCP was not used (per registry, Worker use: Optional, CLI remains primary path); all schema work went through the Supabase CLI (`supabase db push` / `gen types` / `migration list`), same as F163.
- Connectivity was fine this session — `supabase migration list --linked` and `supabase db push --linked` both returned promptly, no BLOCKED needed.
- `npm run test` (full suite, parallel) showed ~19 failing test files, but every single failure I inspected was `Error: ... Request rate limit reached` from Supabase Auth sign-in during concurrent test-file execution (Supabase's auth rate limit being hit by many test files signing in test users in parallel) — none were in `tests/integration/watchers.test.ts`, `add-comment.test.ts`, or `rls-task-watchers.test.ts`. Re-running the four comment/watcher-related suites with `--no-file-parallelism` (serial) gave a clean 25/25 pass. This matches the exact pattern F163's handoff documented for the same reason. If a future worker sees this again, re-run affected files serially before treating it as a real regression.
- Other workers were concurrently touching `lib/actions/tasks.ts`, `components/task/*`, `lib/validation/tasks.ts`, and `lib/supabase/database.types.ts` in the shared working tree (visible as unstaged changes not authored by this worker) — I verified via `git diff` that my own edits to `lib/actions/comments.ts` and `lib/supabase/database.types.ts` are isolated (only my `task_watchers`/`is_watching` and auto-watch-upsert hunks appear in those diffs) and committed only the files this feature actually touches, leaving the other workers' in-progress changes untouched and unstaged for them to commit themselves.
