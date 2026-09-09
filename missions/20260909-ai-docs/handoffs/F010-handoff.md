# Handoff: F010 — Message thread rendering

## Status
COMPLETE

## Assertions covered
AS-062: PASS — `reflects a growing streamed message's text across re-renders, not only at the end` in tests/unit/f010-assistant-thread.test.tsx; rendering is driven directly off `messages` state from `useDocAssistant`, which appends text deltas in place as `text` events arrive (verified against lib/ai/use-doc-assistant.ts's existing behaviour), so each re-render shows the growing string, not a final snapshot.
AS-069: PASS — `'jump to latest' is a real, keyboard-focusable button (AS-069) and scrolls to the bottom on activation` in tests/unit/f010-assistant-thread.test.tsx: it is a native `<button>` (default tab order, not removed via `tabindex="-1"`) with `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` (same visible-focus classes `components/ui/button.tsx` uses elsewhere in this codebase). No other new interactive elements were added by this feature — the thread's message list itself is not interactive.

## Files changed
components/ai/assistant-thread.tsx (new)
components/ai/assistant-sidebar.tsx
tests/unit/f010-assistant-thread.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f010-assistant-thread.test.tsx` (0) — 7/7 passed
`npx vitest run tests/unit/f009-assistant-sidebar.test.tsx lib/ai` (0) — 7 files / 62 tests passed (F009's own suite plus every existing lib/ai unit test, unchanged by this feature)
`npx vitest run tests/unit/docs-markdown-editor-export-import.test.tsx` (0) — 3/3 passed (regression check: this feature reuses the same `tiptap-markdown` extension the doc editor's export/import path depends on)
`npx tsc --noEmit` (1, but only the 4 documented pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — zero new errors)
`npx eslint components/ai/assistant-thread.tsx components/ai/assistant-sidebar.tsx tests/unit/f010-assistant-thread.test.tsx` (0, no output)

Per the mission's standing rule (`state.md`), the full `npm test` was NOT run (it burns the user's live Supabase Auth quota).

## Decisions made
- **Markdown renderer**: looked first, per the spec's instruction. `components/docs/markdown-editor.tsx` already uses `tiptap-markdown`'s `Markdown` extension (not `@tiptap/extension-markdown`, which doesn't exist on npm — see that file's own header comment) to convert between a ProseMirror doc and a plain Markdown string. That same extension also parses a markdown *string* passed as `content`/`setContent` into the ProseMirror doc, which is exactly what a read-only renderer needs. Reused it as a second, `editable: false` `useEditor` instance (`AssistantMarkdown` in assistant-thread.tsx) rather than adding `react-markdown` or any other new dependency — same `StarterKit` + `Markdown` extension pair, same `prose` CSS class the doc editor already uses (`app/globals.css`'s existing `.prose` rules, no new styles needed).
- One `AssistantMarkdown` editor instance per assistant message, keyed by `message.id` (stable across re-renders since `useDocAssistant` mutates the same message object's `text` field in place rather than replacing the id). Content is kept in sync via a `useEffect` that calls `editor.commands.setContent(text, { emitUpdate: false })` only when the current serialized markdown differs from the incoming `text` prop — this avoids remounting an editor (and losing scroll-adjacent DOM identity) on every streamed token, and `emitUpdate: false` guarantees this read-only view never fires an `onUpdate` (there isn't one to fire, but being explicit documents the intent).
- **Auto-scroll**: implemented as a small `useStickToBottom` hook local to assistant-thread.tsx (not extracted to `lib/` since nothing else needs it yet). It tracks "stuck" state via a `scroll` listener computing `scrollHeight - scrollTop - clientHeight <= 40px`, and only force-scrolls to the bottom on new content (message count OR total rendered text length changing) while already stuck. When not stuck, a "Jump to latest" button appears instead of forcing the scroll position — this satisfies the spec's explicit "does not fight the user" requirement, which the spec itself calls out as the single most common defect in streaming chat UIs.
- `aria-live="polite"` (not `assertive`) plus `role="log"` on the thread container — `role="log"` is the standard ARIA role for a running transcript/chat log and pairs naturally with `aria-live="polite"`, so a screen reader announces new content without interrupting whatever the user is currently doing, matching the spec's explicit reasoning for why `assertive` would be wrong here.
- **Bubble treatment**: user turns get `bg-muted` + `rounded-lg`, right-aligned via a `flex justify-end` wrapper — same neutral `bg-muted` register F009 already uses elsewhere in this panel (the composer placeholder), so no new colour token was introduced. Assistant turns render with zero background/rounding classes, sitting directly on the panel's own `bg-background` ground, per the spec's "no bubble — it is the dominant voice" instruction.
- `--line-row` was not needed in this file: the spec's internal-separator guidance applies to rows within a single region (e.g. tool cards in F011), and this feature's turns are visually separated by vertical gap (`gap-3`) rather than a rule, so no `divide-line-row`/`border-line-row` usage was required here. No `border-border` was used either (avoiding the "two-family" mixup the F009 handoff flags).
- Font weights: `font-medium` (510) on the user bubble text and the "Jump to latest" label — no `font-semibold` usage was needed since nothing in this feature is a heading-weight element.
- Zero shadow: confirmed no `shadow-*` class appears anywhere in assistant-thread.tsx (the panel itself is not an overlay, and neither is this thread region within it).
- `--text-quaternary`: not used anywhere in this feature (nothing here is a decorative/non-essential label); the F009-flagged gap (token referenced in CLAUDE.md but never wired into `app/globals.css`) remains open and unaffected by this feature — see Out-of-scope work needed.
- Replaced `assistant-sidebar.tsx`'s F009 placeholder `overflow-y-auto` on the outer thread region with the scroll region living inside `AssistantThread` itself (`assistant-thread.tsx`'s own `overflow-y-auto` on the `role="log"` container) — the outer region still owns padding/`min-h-0`/`flex-1` so the reserved tool-cards region (F011) and the error banner remain siblings below the scrollable thread rather than being pulled into its scroll area, matching F009's DOM-slot comment ("Thread region ... F010's mount point").

## Out-of-scope work needed
- Tool call cards — F011 (reserved `assistant-sidebar-tool-cards-placeholder` div left untouched, per F009's handoff and this feature's own "Out of scope" section).
- Proposal accept/reject cards — F015/F016.
- Composer internals (send/stop wiring) — F012.
- Real empty-state copy — F013 (this feature only renders `AssistantThread` when `messages.length > 0`; the empty-state branch in assistant-sidebar.tsx is untouched).
- `--text-quaternary` token gap flagged by F009's handoff is still open and was not touched by this feature (nothing here needed a decorative-only label).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `role="log"` in addition to the spec's explicit `aria-live="polite"` requirement — this is the standard ARIA pattern for a chat/transcript region and does not conflict with or override the polite-not-assertive instruction; it's additive semantic correctness, not a deviation.
AUTONOMOUS_DECISION: Keyed the per-message markdown editor by `message.id` and diffed against the incoming `text` before calling `setContent`, rather than recreating the editor on every token — the spec didn't specify this mechanic explicitly, but it's the only way to satisfy AS-062 (progressive rendering) without remounting (and losing) editor/DOM state on every streamed delta.

## Notes for the next worker
- `AssistantThread` is exported from `components/ai/assistant-thread.tsx` and takes exactly one prop, `messages: AssistantMessage[]` (the same type `useDocAssistant` returns) — it does not read `isStreaming`, `error`, `toolCalls`, or `proposals`. F011 (tool cards) should render its own region as a sibling of `<AssistantThread />` inside `assistant-sidebar.tsx`'s thread `<div>` (the reserved `assistant-sidebar-tool-cards-placeholder` div is still there, right after where `AssistantThread` now renders) — do not thread tool-call data through `AssistantThread` itself; keep the two concerns (message bubbles vs. tool cards) in separate components as F009's DOM sketch implies.
- The "jump to latest" affordance is `position: absolute` inside a `position: relative` wrapper that also contains the scrollable `role="log"` div — if F011/F012 change the parent's layout (e.g. give the thread ancestor `overflow: hidden` with different bounds), re-check that the absolute positioning still lands at the bottom of the *visible* thread area, not the whole panel.
- No MCP tools were used for this feature — pure client-side UI rendering with no external service or live schema dependency.
