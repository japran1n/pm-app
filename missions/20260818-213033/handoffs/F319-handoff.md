# Handoff: F319 — editTask fans out watcher_update notifications for field edits

## Status
COMPLETE

## Assertions covered
AS-294: PASS — new real-Supabase integration tests (`tests/integration/f319-edit-task-fanout.test.ts`) prove a watcher receives a `watcher_update` notification row when `editTask` changes title or priority; a no-op save (identical title) produces zero notifications; the actor themselves is never notified even when self-watching. `moveTaskStatus`/`moveAndReorderTask` (status changes) and `addComment` (comments) already covered the narrower slices of AS-294; this closes the remaining gap for general field edits (title/priority/due-date/estimate).

## Files changed
lib/actions/tasks.ts
tests/integration/f319-edit-task-fanout.test.ts
missions/20260818-213033/handoffs/F319-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings)
`npx vitest run tests/integration/f319-edit-task-fanout.test.ts tests/integration/f306-mutation-fanout.test.ts tests/integration/edit-task.test.ts tests/integration/notification-fanout.test.ts` (0, 28/28 passed)
`npx vitest run` (full suite; 223 passed / 32 failed test files — all 32 failures pre-existing on unmodified `main`, confirmed via `git stash` + re-run of two representative failing files: `tests/integration/workspace-role-expansion.test.ts`, `tests/unit/trash-list.test.tsx`, both fail identically without this feature's changes)

## Decisions made
- Reused the existing "status_changed" `FanoutEvent` (which already maps to the `watcher_update` `NotificationKind`) rather than adding a new event type/kind to `lib/notifications/fanout.ts`. The notification's purpose ("something about a watched task changed") is identical regardless of which specific field changed, and this keeps `fanout.ts` (a pure module the spec explicitly protects from unnecessary churn) untouched.
- Scoped the fan-out to fire only when `diffTaskFields` (F195) actually produced at least one change (`changes.length > 0`), inside the SAME try/catch block as `writeTaskFieldChanges`, immediately after it. This matches the exact set of fields already activity-logged (title, priority, due_date, estimate_minutes) — no new notification-worthy fields were invented, and a no-op save (edits with no diffable change) fires nothing, per this codebase's "diff first, only act on real changes" convention (also matches `moveTaskStatus`'s identical pattern for status).
- Description changes are NOT included in this fan-out because `diffTaskFields`/`writeTaskFieldChanges` never diffs `description`/`description_json` either (mention notifications for description are handled entirely separately by F205's `notifyNewlyMentionedUsers`, a pre-existing, distinct code path this feature does not touch).
- Passed `actorId: user.id` (the authenticated caller) so `computeFanoutRecipients`'s own actor-exclusion (AS-384) naturally excludes the editor from their own edit's notifications, including the self-watching case, without any extra logic here.
- Non-fatal on failure (wrapped in the existing `writeTaskFieldChanges` try/catch's success path with its own nested try/catch for the fan-out specifically), consistent with every other fan-out call site (`moveTaskStatus`, `moveAndReorderTask`, `addComment`) never failing the underlying mutation.

## Out-of-scope work needed
None identified for this feature's exact scope. (Not in scope, and not attempted: notifying watchers of description-only edits — that's already handled by the separate F205 mention-diff path, and description is not part of `diffTaskFields`'s field set, so extending this fan-out to cover it would be inventing notification-worthiness for a field this fix's spec explicitly said not to.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to reuse the `"status_changed"` FanoutEvent type (rather than defining a new `"task_edited"` event) for the editTask fan-out, per the task instructions' own suggestion that this is "likely correct and consistent" — confirmed by reading `fanout.ts`'s `NotificationKind` union, which only has one relevant kind (`watcher_update`) for this purpose regardless of which field triggered it.

## Notes for the next worker
- `editTask`'s new fan-out block lives directly inside the existing `try { ... writeTaskFieldChanges ... }` block in `lib/actions/tasks.ts` (search for `F319` in that file), immediately after the `writeTaskFieldChanges` call, gated on `changes.length > 0`.
- No MCP usage was needed for this feature — no schema/migration change, no new `notifications_kind_check` value (the existing `watcher_update` kind already covers this), so nothing to introspect via Supabase MCP beyond what `mcp-registry.md` already documents as verified.
- The full-suite run has 32 pre-existing failing test files unrelated to this change (invite-member flow returning `ok:false` under `SUPABASE_SECRET_KEY`/rate-limit-sensitive conditions when run in a long full-suite batch, TrashList's `useRouter` mounting issue, a `cookies()`-outside-request-scope unhandled rejection in an unrelated component test) — verified via `git stash` that these fail identically on unmodified `main`, so they are not regressions from this feature.
