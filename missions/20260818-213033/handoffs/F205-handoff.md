# Handoff: F205 — mentions in task descriptions

## Status
COMPLETE

## Assertions covered
AS-378: PASS — unit tests in tests/unit/description-mentions.test.ts (diffing logic, including the spec's own required "editing an unrelated word does not re-notify existing mentions" case) and integration tests in tests/integration/edit-task-description-mentions.test.ts (server-side mention-visibility enforcement on descriptionJson, and the direct-write survival fix) all pass against the real linked Supabase project.

## Files changed
components/task/task-detail-sheet.tsx
lib/actions/tasks.ts
lib/validation/tasks.ts
lib/notifications/mentions.ts (new)
supabase/migrations/20260822234252_task_description_json_editor_write.sql (new)
tests/unit/description-mentions.test.ts (new)
tests/integration/edit-task-description-mentions.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/notifications/mentions.ts lib/validation/tasks.ts lib/actions/tasks.ts components/task/task-detail-sheet.tsx tests/unit/description-mentions.test.ts tests/integration/edit-task-description-mentions.test.ts` (0)
`npx vitest run tests/unit/description-mentions.test.ts tests/integration/edit-task-description-mentions.test.ts tests/integration/edit-task.test.ts` (0, all passed after one test fix)
`npx vitest run tests/unit/task-detail-sheet-undo.test.ts tests/unit/comment-list.test.ts tests/unit/board-task-detail-sheet-wiring.test.ts tests/unit/checklist-ui-render.test.ts tests/integration/task-detail-sheet-time-total.test.ts tests/integration/edit-task.test.ts` (0 — regression check on every existing test that touches this Sheet/editTask)
`npm run test` (0 — full suite; 25 pre-existing failures, all in unrelated integration test files: invite-member, open-blockers, recurrence-scheduled-generation-activity, trash-view, workspace-members-list, workspace-role-expansion — all "Test timed out in 30000ms" against real Supabase Auth Admin calls, present before this feature's changes and unrelated to tasks/comments/descriptions/mentions; verified none touch this feature's files)
`supabase db push --include-all` (0 — applied the new migration to the linked project qcipqonnqajmazdbysow)

## Decisions made
- Reused `lib/actions/comments.ts`'s `getMentionCandidates(taskId)` directly for the description composer's suggestion source instead of writing a second, near-identical action — it is already generic over `taskId` (not comment-specific) and already narrows to the task's own project-visibility-scoped member set via `resolveVisibleMentionIds`. Simpler option, no second source of truth (per the clarified "ambiguity resolution" answer).
- Reused `lib/comments/mentions.ts`'s `sanitiseMentionsForVisibility` unchanged from `editTask` (same call signature `addComment`/`editComment` already use) rather than writing a description-specific variant — the visibility rule is project-scoped, and task descriptions are already project-scoped, so no new rule was needed (per the mission-brief's explicit instruction).
- `editTask` writes `description_json` ALONE when `updates.descriptionJson` is present — never alongside the legacy `description` field in the same call. This matches the direct-write trigger condition F173 already established (`20260822130000_task_description_json_direct_write.sql`).
- Kept the read-only Preview (`RichTextRenderer` with `onToggleTaskItem`) underneath the new `RichTextEditor` UNCHANGED, rather than removing it — F173's AS-311 checkbox-toggle behaviour is out of scope for this feature and must not regress. The new `RichTextEditor` above it is the description's editing surface; the Preview is unaffected display.
- `lib/notifications/mentions.ts`'s `notifyNewlyMentionedUsers` is a documented no-op stub (logs + echoes the diffed ids, never throws, sends nothing) — F206-F212 (the notification fan-out chain) do not exist yet in this repo. Building real delivery here would be out of scope; this is the seam a future F207 worker replaces.
- AUTONOMOUS_DECISION: found and fixed a real data-loss bug in the existing `tasks_update_search_vector()` trigger, surfaced by this feature wiring `editTask` into a code path that sometimes writes `description_json` alone and, on a later call, writes neither `description` nor `description_json` at all (e.g. a title-only edit). Under the pre-F205 trigger rule ("description_json changed AND description did NOT change" -> keep it; otherwise derive FROM description), that later untouched-both-fields call fell into the "derive FROM description" branch and silently overwrote/discarded the stored rich document (and any mentions in it) using the stale legacy plain-text column. Added migration `20260822234252_task_description_json_editor_write.sql`: a three-way rule (description changed -> derive from it; description_json changed alone -> keep it; neither changed -> leave both columns untouched). Pure function logic change (`create or replace function`), no new columns, no backfill, additive per this mission's convention. Verified via a dedicated integration test (`AS-378: descriptionJson is written directly ... so it survives the next write`) that fails against the pre-fix trigger and passes against the fixed one. Applied to the real linked Supabase project via `supabase db push --include-all`.

## Out-of-scope work needed
- The legacy plain-text `tasks.description` column is now NEVER written by the description editing UI (it was replaced by the RichTextEditor bound to `descriptionJson`). Existing rows/readers of `description` are unaffected, and `description_text` (the FTS projection) stays correctly derived from `description_json` going forward, but any future reader that still expects `description` to reflect the CURRENT description text (rather than whatever it was before this feature shipped, or before F170's trigger last derived it) will see it go stale. This mirrors the exact debt flagged in `20260822090000_task_description_json.sql`'s own header comment ("a later feature ... wiring the rich-text editor into the write path" — this feature) and `20260822130000`'s ("out of scope for F173 ... wiring the full RichTextEditor into that write path ... is a separate feature"). A future cleanup feature (candidate for F270, the same feature already slated to drop the legacy column per this mission's "additive first, drop later" convention) should either backfill/derive `description` FROM `description_json` on every write, or simply stop reading `description` anywhere it still matters.
- Real notification delivery for newly-mentioned users in a task description (F206-F212). `lib/notifications/mentions.ts`'s `notifyNewlyMentionedUsers` is the documented seam — swap its body for a real enqueue call once the notification fan-out chain exists; every call site (`editTask`) keeps working unchanged.
- The description composer's mention picker (`descriptionMentionSuggestions` in `task-detail-sheet.tsx`) is fetched via a `useEffect` on every Sheet render for a task, same as `comment-list.tsx`'s own pattern — no caching/dedup between the two if a caller renders both simultaneously (they always do, since Comments/Description share the same Sheet). This is an accepted, pre-existing inefficiency of the pattern this feature reused, not introduced by it — flagged for a future perf pass, not blocking.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: fixed the `tasks_update_search_vector()` trigger's description_json derivation rule (see Decisions made above) without asking — this was a correctness bug that would have silently broken this feature's own core guarantee ("a description's mentions survive a save") the moment any OTHER field on the same task was edited afterward. Not doing so would have meant shipping AS-378 in a state that fails its own definition of done under ordinary use. Migration applied directly to the linked Supabase project via the CLI (`supabase db push --include-all`), per the mission's connect-phase convention (workers use `supabase migration new` / `supabase db push` directly, no MCP required for this feature per its Notes).

## Notes for the next worker
- `lib/comments/mentions.ts`'s `sanitiseMentionsForVisibility`/`resolveVisibleMentionIds` are the single source of truth for "who's a visible mention target" across BOTH comments and descriptions now — do not add a third copy of this rule for any future mention surface (e.g. a project description, if one is ever added); reuse this same function.
- `lib/notifications/mentions.ts` has zero Supabase/network access by design (pure diffing + a documented no-op). When F206-F212 build real delivery, the natural integration point is replacing `notifyNewlyMentionedUsers`'s body — the diff logic (`extractNewlyMentionedIds`) should not need to change.
- No MCP tools were used for this feature (Notes for clarification: "MCP at run: none"); the Supabase CLI (`supabase db push`) was used directly for the one migration this feature needed, per `connections/mcp-registry.md`'s own guidance ("Primary path for schema changes remains the Supabase CLI").
