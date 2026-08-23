# Handoff: F314 — mention picker: real suggestion-plugin coverage, rename repaint, pristine-window recreation guard

## Status
COMPLETE

## Assertions covered
AS-371: PASS — real Suggestion-plugin tests (`describe("F314: the real Tiptap Suggestion plugin lists and narrows candidates")` in `tests/unit/mention-extension.test.tsx`) genuinely drive `@tiptap/suggestion` via `editor.commands.insertContent("@")` on a real `useEditor`+`EditorContent` React tree, then assert the real, portal-rendered `MentionList` popup lists every candidate. Supporting unit tests (empty-query/listbox/escape) still pass.
AS-372: PASS — same real-plugin harness continues the suggestion session with `editor.commands.insertContent("gr")` and asserts the live picker narrows to the matching candidate, plus a scoped-candidate-list test proving a member absent from `getItems()` never appears in the real popup.
AS-373: PASS — `mentionSuggestionsKey` (both `RichTextEditor` and `RichTextRenderer`) now keys on `id:label`, not id alone; new tests `test_AS_373_rename_with_the_same_id_recreates_the_editor_and_repaints_the_chip` and `test_AS_373_editor_side_rename_also_recreates_when_pristine` reproduce the exact scrutiny-pass repro (same id, changed label) and assert the chip repaints. All pre-existing AS-373 tests still pass.
AS-378: PASS — client half closed by the real-plugin tests above (AS-371/AS-372 harness); server half unaffected by this feature (out of scope — see F313, already GREEN per prior verification).

## Files changed
components/editor/rich-text-editor.tsx
tests/unit/mention-extension.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings only)
`npx vitest run tests/unit/mention-extension.test.tsx tests/unit/comment-mentions* tests/unit/mention-picker-narrowing* tests/unit/description-mentions* tests/unit/rich-text-editor* tests/unit/comment-list* tests/unit/editor-paste-rules* tests/unit/editor-task-list-checkboxes*` (0 — 89/89 passed)
`npx vitest run` (full suite; exit 0, 31 failed test files / 22 failed tests are pre-existing integration-test failures requiring a live backend — verified by `git stash` + rerunning `tests/integration/workspace-role-expansion.test.ts` in isolation against unmodified `main`, which fails identically without any F314 change in the tree)

## Decisions made
- Issue 1 (no real Suggestion-plugin coverage): a bare `new Editor(...)` constructed outside React was tried first and rejected — `@tiptap/react`'s `ReactRenderer` (used by `mention-extension.ts`'s `render()`) only actually attaches DOM once the editor is driven through `EditorContent`'s own portal host (`editor.contentComponent` / `editor.isEditorContentInitialized`), so a standalone `Editor` silently never renders the picker. Settled on a minimal test-only `useEditor` + `EditorContent` React component (same primitives `RichTextEditor` itself uses) — real StarterKit, real `createMentionExtension`, real `Suggestion` plugin, real portal — driven by `editor.commands.insertContent(...)` to produce genuine ProseMirror transactions (typing simulation via DOM events remains unreliable in jsdom, per this file's existing header note).
- Issue 2 (rename repaint): `mentionSuggestionsKey` changed from `.map(item => item.id).join(...)` to `.map(item => \`${item.id}:${item.label}\`).join(" ")` in both `RichTextEditor` and `RichTextRenderer` — a rename now changes the key and forces the same destroy/recreate path F310 already established for id-set changes.
- Issue 3 (focus/typing loss on late candidate arrival): chose mitigation (a) from the spec — freeze `mentionSuggestionsKey` advancement once the editor has been focused or has received a real edit ("pristine window" tracked via `pristineRef`/`focusedRef`, applied through a `useState`-backed `mentionSuggestionsKey` updated from a `useEffect` rather than during render, since this codebase's `react-hooks/refs` lint rule forbids reading `ref.current` during render). Rejected (b) "preserve/restore selection across destroy-recreate": Tiptap 3.30.2's `Editor` exposes no supported hook to transplant `prosemirror-history`'s internal `HistoryState` onto a freshly constructed `EditorState`, and even a perfect selection restore wouldn't save undo history — the pristine-window approach preserves both for free by simply not destroying the instance while the user is interacting.
- Found and fixed a real bug while testing the pristine-tracking logic: `useEditor({ immediatelyRender: false })` defers editor construction into an effect, and that construction dispatches one synthetic "set initial doc" transaction that fires `onUpdate` even with zero user interaction — without accounting for it, `pristineRef` would flip to dirty on every mount/recreation and permanently freeze the key, silently defeating both this fix and (more importantly) F310's original fix. Added `onCreate`-driven `justConstructedRef` to swallow exactly that one synthetic update per editor instance before treating any further `onUpdate` as a real edit. Regression tests (`test_AS_371_test_AS_372_test_AS_373_editor_recreates_its_mention_source_when_mentionSuggestions_populates_post_mount` and the new pristine-recreation test) caught this before it shipped.
- NUL-byte separator fix: `RichTextEditor`'s `mentionSuggestionsKey` used `.join("\x00")` (invisible; `grep`/`file` reported the whole source file as binary because of it) — switched to `.join(" ")`, matching `RichTextRenderer`'s existing separator. No behavioural change (still a unique-enough delimiter for this codebase's id/label data).

## Out-of-scope work needed
None identified beyond what's already tracked elsewhere in the mission (e.g. F313's template-mention-bypass work, already landed/verified separately).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose mitigation option (a) (freeze recreation while non-pristine) over (b)/(c) per the spec's explicit steer that a smaller, real, tested mitigation beats an elaborate unverified one — documented the accepted tradeoff (a very-late candidate list won't retroactively light up an in-flight composition) directly in the code comment.
AUTONOMOUS_DECISION: Used a `useEditor`+`EditorContent` test-only wrapper (not the production `RichTextEditor`) for the real-Suggestion-plugin tests, to keep the test focused on the shared extension/plugin mechanism rather than `RichTextEditor`'s unrelated toolbar/task-item-id concerns, while still exercising a fully real React + Tiptap + ProseMirror + Suggestion-plugin pipeline (no mocking of any of those).

## Notes for the next worker
- If a future change touches `RichTextEditor`'s `onUpdate`/`onCreate`/`useEditor` options again, remember the "first `onUpdate` after every construction is synthetic, not a user edit" gotcha documented inline — it's easy to reintroduce this bug (it manifested as `mentionSuggestionsKey` freezing at its very first value forever, which looks like "the picker just stops working after any state change" in manual testing).
- `file <path>` / `grep` (without `-a`) reporting `components/editor/rich-text-editor.tsx` as binary is EXPECTED and not a new bug — `sanitiseHref`'s control-character regex (`/[\x00-\x1f\x7f\s]/g`) contains a literal `\x00`-`\x1f` byte range that trips binary detection; use `grep -a` or a Python/byte-level read on this file.
- No MCP tools used — this is a pure client-side editor/test feature with no external service or live-schema surface per `mcp-registry.md`.
