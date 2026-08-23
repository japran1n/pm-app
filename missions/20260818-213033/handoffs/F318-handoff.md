# Handoff: F318 — Fix stale `editor` closure in `handleKeyDown` (data-loss bug)

## Status
COMPLETE

## Assertions covered
AS-378: PASS — `test_AS_378_escape_after_mention_triggered_recreation_does_not_throw_and_still_blurs` in `tests/unit/rich-text-editor.test.tsx` reproduces the exact sequence (mount with empty `mentionSuggestions`, re-render with populated candidates to trigger F310/F317's deps-driven Editor recreation, then focus + Escape) and passes against the fixed code. Verified it FAILS against the pre-fix code (`editor?.commands.blur()` throws `Cannot read properties of null (reading 'commands')`) by stashing only the component change and re-running the test.

## Files changed
components/editor/rich-text-editor.tsx
tests/unit/rich-text-editor.test.tsx

## Commands run
`npx vitest run tests/unit/rich-text-editor.test.tsx` (0, 10/10 pass)
`npx vitest run tests/unit/rich-text-editor.test.tsx tests/unit/mention-extension.test.ts tests/unit/comment-mentions.test.ts tests/unit/mention-picker-narrowing.test.ts tests/unit/description-mentions.test.ts tests/unit/comment-list.test.tsx tests/unit/editor-paste-rules.test.ts tests/unit/editor-task-list-checkboxes.test.ts tests/integration/edit-task-description-mentions.test.ts` (0, 79/79 pass)
`npx tsc --noEmit` (0, no output)
`npx eslint components/editor/rich-text-editor.tsx tests/unit/rich-text-editor.test.tsx` (0, no output)
`npm test` (1, 40 files / 58 tests failed — all pre-existing, unrelated to this feature; see Decisions made)
Repro-only: `git stash push -- components/editor/rich-text-editor.tsx && npx vitest run tests/unit/rich-text-editor.test.tsx && git stash pop` (confirmed the new test fails with the pre-fix component and the reported throw)

## Decisions made
- Reproduced and confirmed the exact bug mechanism described in the feature spec by reading `node_modules/@tiptap/core/dist/index.js`'s `blur` command source directly: `editor.commands.blur()` defers the actual `view.dom.blur()` call inside a `requestAnimationFrame` callback that itself closes over `editor`/`view` from the moment `commands.blur()` was invoked — doubly stale after a recreation, not just the initial access.
- Fix: `handleKeyDown`'s Escape branch now calls `view.dom.blur()` directly (`view` is ProseMirror's own per-invocation-correct parameter, never stale) instead of `editor?.commands.blur()`. Audited the rest of the `editorProps` block (`handlePaste`, `transformPastedHTML`) — both already used `view`/pure functions of their arguments, no other stale-`editor` reads found.
- Removed the explicit `onBlur?.()` call that used to sit next to `editor?.commands.blur()`: `view.dom.blur()` is synchronous (unlike the deferred `rAF`-wrapped original), so it synchronously triggers ProseMirror's native blur event → the editor's own `onBlur` option (`wasFocusedRef.current = false; onBlur?.()`, configured further down in the same `useEditor` call) already fires the caller's `onBlur` once. Keeping the extra explicit call would have double-fired `onBlur` per Escape press (confirmed via a failing assertion count of 2 vs the expected 1 before this adjustment). This is a necessary, in-scope adjustment to the exact line the spec asked me to fix, not a scope expansion.
- Did not attempt to replace `editor.commands.blur()` with a `view.state`/`view.dispatch`-only equivalent for anything beyond blur, since `Escape` is the only place in this file's `editorProps` block that read the outer `editor` variable — `handlePaste`/`transformPastedHTML` were already `view`/argument-only.
- `npm test`'s 40 failing files/58 failing tests are pre-existing and unrelated to this feature: they are Supabase-integration tests (`workspace-role-expansion.test.ts`, `comment-format-realtime.test.ts`, etc.) failing with "Something went wrong. Please try again in a moment." (transient Supabase connectivity in this sandboxed run) and a `cookies() called outside a request scope` Next.js error inside `user-avatar.test.tsx`'s effect chain (unrelated component, unrelated code path). None of the failing test files touch `rich-text-editor.tsx`, `handleKeyDown`, `RichTextEditor`, or `RichTextRenderer`; `tests/unit/rich-text-editor.test.tsx` itself is 10/10 passing both standalone and inside the full run.

## Out-of-scope work needed
None identified specific to this fix. The spec's other two findings from the same scrutiny pass (F319, F320 per the mission's scrutiny log) are separate features and were not touched here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the explicit `onBlur?.()` call alongside the `view.dom.blur()` fix (see Decisions made) — this was necessary because switching from the async `rAF`-deferred `commands.blur()` to a synchronous `view.dom.blur()` call surfaced a double-invocation of `onBlur` that the async version had been silently masking (the async version's own native blur, and thus the editor's registered `onBlur` option, only fired after the test's synchronous assertions had already run). Verified via the existing `test_AS_313_escape_blurs_editor_and_preserves_buffer_content` test, which asserts `onBlur` is called exactly once and would fail on a double-call.

## Notes for the next worker
- The `blur` command's `requestAnimationFrame` deferral (`node_modules/@tiptap/core/dist/index.js` around line 264) is itself worth knowing about if another handler in this codebase ever needs "blur the editor" — it is NOT synchronous, and it also captures `editor`/`view` from the call site rather than deferring to whatever's live when the frame runs, so it inherits the same staleness class of bug this feature fixed for any future spot that used it after a possible recreation.
- No MCP tools were used — this is a pure client-side component/test fix with no external service surface.
