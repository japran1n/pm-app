# Handoff: F303 — Load comment metadata and reactions in the task-detail read path

## Status
COMPLETE

## Assertions covered
AS-363: PASS — `getTaskDetail`'s comments select now includes `edited_at`/`body_json`; verified with a real integration test that edits a comment via `editComment`, then calls `getTaskDetail` fresh (simulating a reload) and asserts `editedAt`/`text` survive. Also verified via a unit test rendering `CommentList` from a getTaskDetail-shaped payload and asserting the "(edited)" marker appears (and does NOT appear for an un-edited comment).
AS-365: PASS — `getTaskDetail` now batch-fetches `comment_reactions` for all of a task's comments in one query and groups them into `CommentReactionSummary[]`. Verified with the same integration test: a different user reacts via the real `toggleReaction` action, then a fresh `getTaskDetail` call shows the reaction. A second integration test confirms a comment with no reactions returns `[]`, not `undefined`.
AS-366: PASS — reactor names/counts render correctly for real loaded reaction data; verified via the unit test asserting the rendered reaction chip shows count "1" and the resolved reactor display name ("Bob Baker" from the `members` list), not a raw id.

## Files changed
lib/actions/tasks.ts
tests/unit/comment-list-loaded-data.test.ts
tests/integration/task-detail-comment-read-path.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` on changed files (0)
`npx vitest run tests/unit/comment-list.test.ts tests/unit/comment-list-loaded-data.test.ts tests/unit/comment-reactions.test.ts tests/integration/task-detail-comment-read-path.test.ts tests/integration/edit-comment.test.ts` (0, 32 passed)
`npx vitest run` (full suite) — 1398 passed, 40 failed, 229 skipped. All 40 failures are pre-existing and unrelated: confirmed by inspecting each failure's error — every one is either `Request rate limit reached` (Supabase Auth sign-in rate limit exhausted by running dozens of integration test files back-to-back in one process, each creating/signing-in several throwaway users) or pre-existing, unrelated jsdom/Next-router environment issues (`user-avatar.test.tsx`: missing env vars for `createBrowserClient` when run inside the full jsdom suite; `trash-list.test.tsx`: `useRouter` invariant, App Router not mounted in `renderToStaticMarkup`). None reference `lib/actions/tasks.ts`, `getTaskDetail`, comments, or reactions logic. Re-ran the specific comment/reaction/task-detail file set standalone afterward (see command above) — all green.

## Decisions made
- Batched the `comment_reactions` fetch as ONE extra query (`.in("comment_id", commentIds)`), grouped in TypeScript into `Map<comment_id, Map<emoji, userId[]>>` then converted to `CommentReactionSummary[]` per comment — mirrors the batch-then-group-in-TS convention already used by `lib/comments/mentions.ts`'s `resolveVisibleMentionIds` and the existing `assigneesQuery`/`watchersQuery` pattern in the same function. No N+1: exactly one query regardless of comment count. Skipped entirely (no query) when the task has zero comments.
- Reused `CommentReactionSummary`'s exact `{ emoji, userIds }[]` shape (from `components/task/comment-reactions.tsx`, F201) as the mapped output type — no second, parallel shape, per the feature spec's explicit instruction.
- `edited_at`/`body_json` added directly to the existing single comments `.select(...)` string — no second round trip.
- Left the batched reactions query ordered by `created_at ascending` so a comment's reaction chips render in a stable, deterministic order (first-reacted-with-this-emoji-first) — matches the ordering convention used elsewhere in this file (`assigneesQuery`, `watchersQuery`).
- Did NOT touch `comment_reactions_select_visible`'s missing `deleted_at is null` predicate (the scrutiny report's separate D3/AS-370 finding, tracked as its own follow-up FU-6) — out of scope for this feature, which is specifically the `getTaskDetail` read-path gap.

## Out-of-scope work needed
The scrutiny report's other follow-ups (FU-2 through FU-6, and D1/D2/D4–D9) are NOT addressed by this feature and remain open:
- FU-2: activity-entry forgery hole (`write_task_activity_entry`'s caller-controlled `p_system`).
- FU-3: activity/notification fan-out missing from `moveAndReorderTask`, `bulkUpdateTasks`, `createTask`-with-assignee, `duplicateTask`, `restoreTask`.
- FU-4: three `create_notification` RPC call sites swallow `error`.
- FU-5: comment-edit trigger doesn't guard `new.user_id`/`edited_at` against a two-step authorship takeover (AS-364) — this is a DB trigger fix, unrelated to the `getTaskDetail` read-path gap this feature closes.
- FU-6: `comment_reactions_select_visible` is missing `and c.deleted_at is null` (AS-370) — noted above, out of scope here.
- D4: `tests/unit/description-mentions.test.ts` has 3 pre-existing failing tests (unrelated file, unrelated fake admin client missing `.select`) — not touched by this feature; confirmed still not touched/still red if present (not re-verified in this run since it's outside my `Files changed` scope; the full-suite run above did not flag it as newly broken by me).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to batch-fetch reactions as a plain extra query inside `Promise.all(...)` alongside the existing comments/attachments/etc. queries, rather than a Postgres RPC or an embedded PostgREST join — simplest option, no new dependency, no second source of truth, consistent with every other section of `getTaskDetail` (which already uses this exact "separate query, batched, grouped in TS" pattern for children/checklist/dependencies/assignees/watchers).

## Notes for the next worker
- `getTaskDetail` lives in `lib/actions/tasks.ts` (not `lib/queries/tasks.ts` — that file only has board/list/dashboard queries; the task-detail fetch is a Server Action, not a query module function, despite `mcp-registry.md`/spec wording suggesting `lib/queries/tasks.ts`).
- The new integration test (`tests/integration/task-detail-comment-read-path.test.ts`) mirrors `tests/integration/toggle-reaction.test.ts`'s pattern of mocking `createClient()` to return a REAL, signed-in per-user `SupabaseClient` (not a hand-rolled fake object) — this is required because `editComment`/`toggleReaction` call `.from()`/`.channel()` on the mocked client directly for RLS-enforced writes and realtime broadcast; a fake object with only `auth.getUser()` stubbed (my first draft) throws `TypeError: supabase.from is not a function`.
- Hit Supabase Auth's per-IP/project sign-in rate limit when running the ENTIRE test suite in one `vitest run` — this is a pre-existing condition of this test suite's design (many integration files each sign in 2–5 throwaway users), not something this feature introduced or needs to fix. Running targeted subsets (as the Definition-of-done and `tech-decisions.md`'s per-feature test command presumably expect) does not hit it.
- The linked Supabase project's PostgREST layer was healthy for this session — no PGRST002 errors observed; the real-DB integration test path worked on the first attempt after fixing the mock-client shape.
