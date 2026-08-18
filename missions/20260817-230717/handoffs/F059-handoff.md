# Handoff: F059 — add comment action

## Status
COMPLETE

## Assertions covered
AS-094: PASS — active workspace member can add a non-empty text comment to a task (tests/integration/add-comment.test.ts)
AS-095: PASS — empty and whitespace-only comment text is rejected before reaching the database (tests/integration/add-comment.test.ts)

## Files changed
lib/actions/comments.ts
lib/validation/comments.ts
tests/integration/add-comment.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/comments.ts lib/validation/comments.ts tests/integration/add-comment.test.ts` (0)
`npx vitest run tests/integration/add-comment.test.ts` (0) — 4/4 passing
`npx vitest run tests/integration` (0) — 200/200 passing (full integration suite, no regressions)
`npm run build` (0)

## Decisions made
- Followed `lib/actions/tasks.ts`'s `createTask` pattern exactly: Zod schema in `lib/validation/comments.ts`, discriminated-union `{ ok, data|error }` return, `requireActiveMembership` from `lib/auth/require-membership.ts` re-checked server-side (defense in depth alongside RLS from F058), admin client for the actual insert, `user_id` set from the server-verified caller id (never client input), generic user-facing error messages with details only logged via `console.error`.
- The clarified spec's "Errors" line mentions Sentry, but the codebase has no Sentry dependency installed and no existing action uses it (`lib/actions/tasks.ts` and siblings all use `console.error`). Followed the actual established sibling convention (`console.error`) rather than introducing a new, unused dependency for one feature — consistent with "never modify files outside scope."
- `taskId` -> workspace resolution: joined `tasks -> projects(workspace_id)` in a single admin-client select (mirrors createTask's separate project lookup, but comments only need the workspace_id so it's fetched via the FK join in one query) rather than a second round-trip query. Non-deleted tasks only (`deleted_at is null`), matching createTask's soft-delete convention for "task not found."
- `revalidatePath(`/w/${slug}`, "layout")` used for cache invalidation, matching every other mutation in `lib/actions/tasks.ts` — wrapped in try/catch since it throws outside an active request/render context (non-fatal, insert already succeeded).
- Test file mirrors `tests/integration/create-task.test.ts`'s structure exactly (loadDotEnv, mocked `@/lib/supabase/server`, `next/cache` mock that throws to simulate no-request-context, seeded workspace/project/task/member fixtures, `afterAll` cleanup). Covers: member success (AS-094), empty string (AS-095), whitespace-only (AS-095), and non-member rejection (defense-in-depth failure case per DoD).

## Out-of-scope work needed
None beyond F059's scope. Comment listing/rendering (F060), delete (F061/F062), and realtime (F063) are separate features per the mission plan and were not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `console.error` instead of Sentry for error logging (see Decisions made above) — no Sentry dependency exists anywhere in the repo, and every sibling action (`lib/actions/tasks.ts`, `lib/actions/projects.ts`, `lib/actions/workspaces.ts`) uses `console.error` for this same purpose. Introducing Sentry for a single feature would be out of scope and inconsistent with the codebase.

## Notes for the next worker
- `lib/actions/comments.ts` exports `addComment(taskId, text)` returning `AddCommentResult`.
- F058's RLS (`comments_insert_active_members` policy + `is_task_workspace_member` helper) independently enforces the same membership rule this action re-checks — both layers were exercised by the test suite (RLS via `rls-comments.test.ts`, this action's own re-check via `add-comment.test.ts`'s non-member test).
- The `comments` table's `text` column has a DB-level `comments_text_not_empty` CHECK (`btrim(text) <> ''`) as the ultimate enforcement boundary for AS-095; the Zod schema's `.trim().min(1)` mirrors it so bad input is rejected before ever reaching the database.
