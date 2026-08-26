# Handoff: F340 — Fix task description mention serialization (same bug class as F339)

## Status
COMPLETE

## Assertions covered
AS-527 was F270's; this is a scrutiny-driven fix under follow-up FU-M18P2-1 (M18 scrutiny pass 2). No new assertion ID was assigned to this fix by plan.md/validation-contract.md; it is a bugfix follow-up scoped to the description-editor save path mirroring F339's comment-editor fix. Verified via the e2e regression spec (see Files changed) that the description save no longer 500s and the mention persists.

## Files changed
components/task/task-detail-sheet.tsx
tests/integration/edit-task-description-mentions.test.ts
tests/e2e/f340-task-description-mention-regression.spec.ts

## Commands run
`git diff components/task/task-detail-sheet.tsx tests/integration/edit-task-description-mentions.test.ts` (0)
`npx playwright test tests/e2e/f340-task-description-mention-regression.spec.ts --workers=1` (0, 1 passed)
`npx tsc --noEmit` (0)
`npx eslint .` (0, only pre-existing unrelated warnings)
`npx vitest run tests/unit` (0, 1339 passed; 1 unrelated unhandled-rejection warning from an existing test file, not introduced by this change)
`npx vitest run tests/integration/edit-task-description-mentions.test.ts` (0, 2 passed)
`npx next build` (0, clean build)

## Decisions made
- Confirmed the product fix in task-detail-sheet.tsx applies `toPlainJson(next)` (imported from `@/lib/comments/rich-text`, the same helper F339 used for comment-list.tsx) at the exact call site where the description editor's live `next` value crosses into `editTask(task.id, { descriptionJson: ... })`. This mirrors F339's fix pattern exactly: `next` is sourced from RichTextEditor's live `onChange(updatedEditor.getJSON())`, and without cloning, a real mention node's `attrs` crossing the Server Action boundary un-cloned triggers "Cannot access id on the server... temporary client reference" 500s.
- Confirmed the integration test file's added comment correctly documents why `tests/integration/edit-task-description-mentions.test.ts` cannot itself catch this bug class (it calls `editTask` directly with a hand-written plain object, never crossing a real RPC boundary) and that the e2e spec is the real regression guard — same reasoning F339 used for comments.
- Fixed the e2e spec's locator: the previous attempt used `[role="textbox"][aria-label="Rich text editor"]` assuming the description RichTextEditor instance used the library's default aria-label, but task-detail-sheet.tsx actually sets a dynamic `aria-label={`Description for ${task.title}`}` (line ~1477). Replaced with `sheet.getByLabel('Description for F340 Description Mention Task')`, matching the actual seeded task title used in this test. Removed the leftover `console.log("DEBUG html:", ...)` debug line from the previous attempt.
- Ran the e2e spec in isolation to confirm the fix: it passes (1 passed), confirming the description save no longer 500s and the mention with the target user's ID persists in `description_json`.

## Out-of-scope work needed
None identified beyond what F339/M18 scrutiny already scoped.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the stray `console.log("DEBUG html:", await sheet.innerHTML())` line left over from the interrupted previous attempt's debugging session — it was not part of the intended final test and would have produced noisy output on every run.

## Notes for the next worker
- The root cause writeup for this bug class lives in `lib/comments/rich-text.ts`'s `toPlainJson` doc comment (referenced from both F339's and F340's fix comments) — read that first if a similar live-editor-JSON-crossing-a-Server-Action bug surfaces elsewhere (e.g. any other RichTextEditor instantiation that saves via a Server Action without going through `toPlainJson`).
- No MCP tools were needed for this fix; it's pure application/test code. The e2e spec does use the Supabase admin client (already-established pattern) to seed/verify data directly, per this suite's established magic-link-then-cookie-injection auth technique (see board-reorder.spec.ts and f272-two-context-notifications.spec.ts for prior art).
