# Handoff: F038 — M2 residue (three findings from M2 re-review)

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to F038 — this is an M2 re-review residue task
(regression fix + two test-quality fixes), not a new-behaviour feature.
`missions/20260909-ai-docs/features/` has no F038-*.md spec file and
`plan.md` assigns no assertions to F038. Nothing to list here.

## Files changed
components/chat/message-composer.tsx
components/ai/assistant-composer.tsx
components/editor/rich-text-editor.tsx
components/ai/assistant-thread.tsx
components/docs/markdown-editor.tsx
tests/unit/f037-message-composer-ime.test.tsx
tests/unit/f012-assistant-composer.test.tsx
tests/unit/rich-text-editor.test.tsx
tests/unit/f010-assistant-thread.test.tsx

## Commands run
`npx vitest run lib/ai tests/unit/f009 tests/unit/f010 tests/unit/f011 tests/unit/f012 tests/unit/f013 tests/unit/f033 tests/unit/f035 tests/unit/f036 tests/unit/f037 tests/unit/rich-text-editor.test.tsx tests/unit/f-bugfix-message-composer-enter-race.test.tsx tests/unit/f123-message-composer-plain-json-boundary.test.tsx` (0, 195 tests passed)
`npx vitest run tests/unit/f-bugfix-message-composer-enter-race.test.tsx tests/unit/f123-message-composer-plain-json-boundary.test.tsx tests/unit/f037-message-composer-ime.test.tsx tests/unit/rich-text-editor.test.tsx tests/unit/f012-assistant-composer.test.tsx tests/unit/f010-assistant-thread.test.tsx` (0, 56 tests passed — chat/composer-specific subset)
`npx tsc --noEmit` (2 — but the exact same 4 pre-existing errors documented in the mission's baseline: `app/layout.tsx` LayoutProps, `components/ui/status-badge.tsx` style prop overload, and 2 in `tests/unit/docs-markdown-editor-export-import.test.tsx`; no new errors)
`npx eslint components/chat/message-composer.tsx components/ai/assistant-composer.tsx components/ai/assistant-thread.tsx components/editor/rich-text-editor.tsx components/docs/markdown-editor.tsx tests/unit/f010-assistant-thread.test.tsx tests/unit/f012-assistant-composer.test.tsx tests/unit/f037-message-composer-ime.test.tsx tests/unit/rich-text-editor.test.tsx` (0, no output)
Mutation verification for item 3: `sed -i` changed `if (!el || !isStuck) return;` to `if (!el) return;` in the "new content arrived" effect of `useStickToBottom` in `components/ai/assistant-thread.tsx`, re-ran `npx vitest run tests/unit/f010-assistant-thread.test.tsx` — the rewritten test went red (`expected 860 to be +0`), confirming it now actually exercises the guard. Restored the original file from the `.sed` backup and re-ran the same command — 10/10 green again.

## Decisions made
- **Item 1 (Android Enter-to-send regression):** Narrowed the IME guard in all three call sites (`message-composer.tsx` rich-editor and plain-textarea paths, `assistant-composer.tsx`, `rich-text-editor.tsx`'s `handleKeyDown`) from "suppress Enter whenever `isComposing` is true, OR `keyCode === 229`" to "suppress Enter only when `isComposing` is true **AND** `keyCode === 229`". `keyCode === 229` is the signal browsers emit specifically for a genuine IME candidate-commit keystroke; Android soft keyboards (GBoard, Samsung) set `isComposing === true` liberally during ordinary Latin typing but do not set `keyCode === 229` on the discrete Enter that follows, so requiring both narrows the guard to the genuine-CJK-commit case without losing CJK correctness. **Tradeoff (documented in-code and here):** a handful of older/less-common IME+browser combinations that commit a candidate without setting `keyCode === 229` will now submit prematurely instead of being suppressed. Accepted because 229 is well-supported by current mainstream CJK IME implementations across Chrome/Safari/Firefox, and a shipped, real-user chat feature silently losing Enter-to-send for a whole platform (Android) is a worse failure mode than a narrow edge case on an already-degraded IME path. This is a genuine correctness tradeoff with no free answer, per the spec's own framing — I picked the "AND" narrowing over a full input-mode/`inputMode` check because it requires no new browser API surface and matches the existing `keyCode === 229` convention already in the codebase's comments.
- **Item 2 (prose-invert removal):** Removed `prose-invert` from `components/ai/assistant-thread.tsx`'s `AssistantMarkdown` and replaced the now-false "no `--tw-prose-*` override anywhere in this repo" comment with one explaining the dependency on `design/linear`'s `bf6b0b69` (global `:root:not([data-surface="portal"])` token mapping). Reverted `components/docs/markdown-editor.tsx` entirely to its pre-F037 state — that commit's *only* change to that file was the same `prose-invert` addition, so reverting the one hunk fully restores the pre-F037 file (verified via `git diff` showing exactly the one hunk reverted, nothing else touched). Kept F037's other changes to `markdown-editor.tsx` N/A here since F037 made no other changes to that specific file (the dead-`getMarkdown()`-guard removal and scroll clamp both live in `assistant-thread.tsx`, which I kept). **Dependency recorded:** correct dark-theme rendering of both `AssistantMarkdown` and the docs editor's `.prose` region now depends on `design/linear`'s `bf6b0b69` landing when the branches merge — without it, these two surfaces will render with `.prose`'s light-theme default colours again. This is a real cross-mission dependency, not a regression introduced by this fix; it existed the moment `prose-invert` was removed and is inherent to the "let the global mapping own this" approach the spec asked for.
- **Item 3 (tautological auto-scroll test):** Rewrote the "does not auto-scroll them back on new content" test to actually rerender with grown message text (stubbing a correspondingly larger `scrollHeight`, as a real DOM would produce) after the initial scroll-away, and assert `scrollTop` is unchanged by that rerender — not just by the initial `fireEvent.scroll`. Verified by mutation (see Commands run) that this test now fails when the `!isStuck` guard is deleted from the "new content arrived" effect, where it previously passed vacuously. Added a `trailing` prop test (F036's tool-card fold-in was previously entirely untested at f010) that asserts the passed content renders inside the same scrollable/aria-live container as the messages, matching the defect F036 fixed (tool cards used to live in an outer non-scrolling sibling `div`). No source code change was needed for item 3 — the `useStickToBottom` guard itself (`if (!el || !isStuck) return;`) was already correct; only the test was tautological.
- Left `components/ai/assistant-composer.tsx`'s test file using the component's actual prop name (`send`/`stop`, not `onSend`) — matched existing sibling tests in that file rather than guessing a prop shape.

## Out-of-scope work needed
None identified beyond what the spec called for. The `design/linear` branch's `bf6b0b69` commit is a genuine cross-mission dependency (see Decisions made, item 2) — no action needed from this mission beyond the fact that it's now recorded; the orchestrator should confirm `bf6b0b69` is present on `design/linear` (or main, post-merge) before considering the dark-theme markdown rendering concern fully closed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the `isComposing && keyCode === 229` "AND" narrowing over an `inputMode`/language-detection-based CJK gate for the Android Enter-to-send fix, because it reuses the exact signal (`keyCode === 229`) the codebase's own F037 comments already treated as the canonical "real IME commit" indicator, requires no new browser API surface, and is easy to verify with `fireEvent.keyDown` in jsdom tests (no `inputMode`/IME-simulation machinery needed). Documented the accepted tradeoff (rare non-229-emitting IME+browser combos will submit prematurely) in-code at all three call sites and here.

## Notes for the next worker
- The three narrowed guards are intentionally kept in lockstep across `message-composer.tsx` (both paths), `assistant-composer.tsx`, and `rich-text-editor.tsx` — if this guard changes again, update all four call sites together (message-composer.tsx has two).
- `components/docs/markdown-editor.tsx` is now bit-for-bit identical to its pre-F037 state on this concern (verified: `git diff` for that file shows exactly one reverted hunk, nothing else). Do not re-add `prose-invert` there — the fix depends on the global token mapping from `design/linear`'s `bf6b0b69`.
- No MCP tools were used for this feature — pure client-side component/test work, no external service or live-schema surface touched.
