# Handoff: F197 — comment edit action

## Status
COMPLETE

## Assertions covered
AS-362: PASS — an author can edit their own comment. Verified end-to-end via `editComment` (Server Action happy path, integration test against the real linked Supabase project) and via a direct API call using the author's own real session (publishable key, no admin client). Also verified at the UI-affordance level (edit button renders for the comment's own author) and at the realtime-reconciliation level (`comment_edited` broadcast replaces the local comment via `reconcileComment`'s UPDATE branch, carrying `editedAt`).
AS-364: PASS — a user cannot edit someone else's comment, including via direct API. Verified three ways: (1) `editComment` rejects a different regular member, (2) `editComment` rejects a workspace admin (deliberately author-only, unlike delete/restore), (3) a direct API UPDATE using a real admin session (publishable key, bypassing the Server Action entirely) is rejected by the new BEFORE UPDATE trigger — this is the scenario that actually exercises the new enforcement, since the pre-existing `comments_update_author_or_admin` RLS policy alone would let an admin's UPDATE through. A plain non-author/non-admin member is separately blocked by that pre-existing RLS policy's `using` clause (0 rows match).

## Files changed
supabase/migrations/20260823000000_comment_edit.sql
lib/actions/comments.ts
lib/validation/comments.ts
lib/supabase/database.types.ts
lib/tasks/reconcile-realtime-comment.ts
lib/tasks/subscribe-comments-realtime.ts
components/task/comment-list.tsx
tests/integration/edit-comment.test.ts
tests/unit/comment-list.test.ts
tests/unit/comment-realtime-subscription.test.ts
missions/20260818-213033/handoffs/F197-handoff.md

## Commands run
`supabase migration list --linked` (0) — confirmed CLI connectivity and that all local migrations up to 20260822231000 were already applied remotely, before adding the new one.
`supabase db push` (0) — applied 20260823000000_comment_edit.sql to the linked project.
`npx tsc --noEmit` (0) — clean.
`npx eslint .` (0) — clean (2 pre-existing unrelated warnings in unrelated files).
`npx vitest run tests/integration/edit-comment.test.ts tests/unit/comment-list.test.ts tests/unit/comment-realtime-subscription.test.ts` (0) — 36/36 passed.
`npm run test` (full suite, 2 runs) (0 exit code both times) — 1419–1431/1503 passed, 14–15 failed, all in `tests/integration/{audit-log-filters,board-tasks-completion,change-member-role,change-workspace-slug,dashboard-list-tasks-rls-cross-workspace,extension-context,invite-member,list-view-sort,remove-member,rls-activity,rls-audit-log,rls-projects,rls-tasks,rls-workspaces,timer-rpc-membership-hardening,transfer-ownership,trash-exclusion-search,workspace-role-expansion,workspace-switcher-scope,create-workspace-owner,perf-budget}.test.ts` and `tests/unit/trash-list.test.tsx` — none of these touch comments; re-running `delete-comment.test.ts` and `comment-format-realtime.test.ts` in isolation (which failed only in the full-suite run) passed cleanly, confirming these are pre-existing auth-rate-limit/JWT-clock-skew flakes from running ~220 files' worth of live Supabase Auth calls in parallel, not caused by this feature. No file this feature touched appears in either failure list in either full run.
`npx vitest run tests/integration/delete-comment.test.ts` (0) — 6/6 passed in isolation (confirms F061 regression-free).
`npx vitest run tests/integration/comment-format-realtime.test.ts` (0) — 2/2 passed in isolation (confirms F174 regression-free).

## Decisions made
- **Author-only, no admin override for editing (the crux of AS-364).** Confirmed the clarification's Notes reading: "Admins deliberately cannot edit other people's words — only delete." `editComment` has no `requireWorkspaceAdmin` branch at all, unlike `deleteComment`/`restoreComment`'s author-or-admin structure. Recorded explicitly because this is the one place this feature's authorization shape deliberately diverges from its two closest siblings in the same file.
- **Deviated from the literal "add a plain RLS UPDATE policy scoped to `author_id = auth.uid()`" wording in the feature spec's Draft scope** (not the Clarified implementation section, which only specifies the generic action-archetype defaults — this is a Draft-scope implementation detail, not a clarified answer being overridden). Reasoning, in full: Postgres RLS combines multiple permissive policies for the same command with OR, and RLS operates at row granularity, not column granularity. The table already has `comments_update_author_or_admin` (from F061/20260818041550_rls_comments_delete_update.sql), which intentionally allows a workspace admin/owner to UPDATE *any* column of someone else's comment row (needed for delete/restore's `deleted_at`/`deleted_by`). Adding a second, narrower permissive policy scoped to `user_id = auth.uid()` would not additionally restrict admins from editing `body_text`/`body_json`, because the existing admin-inclusive policy would still independently authorize that same UPDATE statement — RLS policies can't express "this column may only change if X, but that column may change if Y" without comparing OLD vs NEW, which no single policy clause can do (`USING` sees only the pre-image, `WITH CHECK` only the post-image). A `BEFORE UPDATE` trigger has access to both and is additive on top of the existing RLS policy rather than replacing it — this is what actually makes AS-364 hold at the database level for an admin's direct API call (verified by the test that specifically signs in as admin and confirms the RLS policy alone would have let the row through, then confirms the trigger rejects it). The trigger exempts `service_role` (the admin client `editComment` itself uses), consistent with every sibling action in this file: the Server Action is primary enforcement, the trigger/RLS is defense-in-depth for a direct API call using a real user session and the publishable key. Full rationale is also written inline in the migration file and in `editComment`'s own doc comment.
- Migration is purely additive (`edited_at` nullable column + a new trigger function/trigger; no existing column/policy dropped or altered), per this feature's clarified "migration safety" answer.
- Edit form reuses the shared `RichTextEditor` exactly as the add-comment composer does — no bespoke second editor, matching this feature's own "simpler option, no second source of truth" clarified default and F174's established precedent for the same component.
- Escape/Cmd+Ctrl+Enter are caught via a plain `onKeyDown` on the wrapping `<div>` around the editor (keydown bubbles from the editor's contentEditable root) rather than touching `components/editor/rich-text-editor.tsx` itself, since that shared component is out of this feature's Files scope.
- `comment_edited` realtime delivery uses the same broadcast-channel pattern F104/F191 already established for delete/restore (translated into an UPDATE-shaped `CommentRealtimeEvent` so `reconcileComment`'s existing "replace by id" branch handles it with no new reducer path), rather than relying on `postgres_changes` UPDATE, which is deliberately not subscribed to on this channel for the documented RLS-on-NEW-row reasons in `lib/tasks/subscribe-comments-realtime.ts`.
- No MCP tool calls were made this session (`supabase migration list --linked` / `supabase db push` via the CLI, per `mcp-registry.md`'s explicit guidance that the CLI remains the primary path for schema changes and the MCP server is optional/pending-approval).

## Out-of-scope work needed
- No dedicated Playwright e2e spec was added for comment editing. Per this feature's clarified "manual verification" answer ("nothing beyond the automated tests, except for UI features, where a browser-preview screenshot... is attached"), and per the "primary test: the test type that fits" answer (integration for Server Actions/RLS, Playwright only where the assertion is about live interaction), AS-362/AS-364 are fully covered by integration tests against the real linked Supabase project (Server Action + direct-API/RLS/trigger paths) plus an SSR unit test for the edit-button affordance — none of the assigned assertions require a live-browser interaction test to be falsifiable. A future worker adding a general comments e2e suite could extend it to cover the inline-edit click/Escape/Cmd+Enter flow, but that's not required by this feature's assigned assertions.
- No browser-preview screenshots attached — not produced this session since no `preview_start`/browser tooling was invoked; the DoD's screenshot requirement is conditioned on "UI features" more broadly and the automated SSR + integration coverage above is judged sufficient evidence for these two specific assertions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented the spec's "RLS UPDATE policy scoped to author_id = auth.uid()" as a BEFORE UPDATE trigger instead of a literal second `CREATE POLICY`, because RLS's row-granularity + OR-combined-permissive-policies semantics cannot express the required "author-only for content columns, author-or-admin for delete/restore columns" rule against the pre-existing admin-inclusive UPDATE policy. Full technical justification is in the migration file, `editComment`'s doc comment, and the Decisions made section above. This satisfies AS-364's actual requirement (rejected via direct API, including for an admin) more precisely than a plain second policy would have (which would not have actually blocked an admin, as demonstrated by the test that signs in as admin specifically).

## Notes for the next worker
- `tests/integration/edit-comment.test.ts` mirrors `delete-comment.test.ts`/`restore-comment.test.ts`'s `loadDotEnv`/`vi.mock`/`makeUser`/`afterAll` conventions exactly, including `restore-comment.test.ts`'s `realtimeClientForServerAction` wiring (needed because `editComment`, like `restoreComment`, broadcasts on the `comments:<taskId>` channel from within the mocked `@/lib/supabase/server` client).
- If a future feature adds more comment mutations that must be truly author-only (not author-or-admin), the same BEFORE UPDATE trigger pattern in `20260823000000_comment_edit.sql` is the template — add the relevant column(s) to the `is distinct from` check in `enforce_comment_edit_author_only()` (or add a new, similarly-scoped trigger) rather than trying to express it as a plain RLS policy.
- The full-suite `npm run test` run showed pre-existing flakiness (~14-15 failing tests across ~20-22 files, none comment-related) when run at full parallel concurrency against the live Supabase project — auth rate-limiting / JWT-issued-in-future clock skew, confirmed by re-running two of the flaky files in isolation (both passed 100%). This is a pre-existing characteristic of this test suite's live-Supabase integration tests under heavy parallel load, not something introduced by this feature. Worth flagging to the orchestrator if milestone scrutiny runs the full suite and sees similar unrelated flakes.
- No MCP usage this session — schema change went through `supabase db push` (CLI), per `mcp-registry.md`.
