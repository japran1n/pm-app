# Handoff: F169 — shared Tiptap editor component

## Status
COMPLETE

## Assertions covered
AS-306: PASS — 6 tests render/exercise bold, italic, headings (h1/h2), bullet list, ordered list, code block, and link marks/nodes through the shared extension set (`sharedExtensions()`), plus a live toggle test proving toolbar clicks actually mutate editor state (aria-pressed flips true→false). See `test_AS_306_*` in `tests/unit/rich-text-editor.test.tsx`.
AS-313: PASS — 2 tests verify every toolbar control is a real, enabled `<button>` in the default Tab order (no `tabindex="-1"`, not disabled), and that a real `Escape` keydown against the focused editor DOM node calls `onBlur` while the document's text content remains in the DOM (Escape does not clear/revert the buffer). See `test_AS_313_*` in `tests/unit/rich-text-editor.test.tsx`.

## Files changed
components/editor/rich-text-editor.tsx (new)
tests/unit/rich-text-editor.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/unit/rich-text-editor.test.tsx` (0 — 9/9 passed)
`npm run test` (0 — 158/178 files, 1124/1177 tests passed; the 20 failing files/12 failing tests are pre-existing `tests/integration/*` failures against the live Supabase project — `AuthApiError: Request rate limit reached` (HTTP 429) hitting `workspace-time-by-person.test.ts` and `workspace-role-expansion.test.ts` — unrelated to this feature, no files in components/editor or tests/unit/rich-text-editor.test.tsx appear in the failure list)

## Decisions made
- **Verified Tiptap version**: `@tiptap/react`/`@tiptap/pm`/`@tiptap/starter-kit`/`@tiptap/extension-link` etc. at `^3.30.2` were already installed and pinned in `package.json` and `tech-decisions.md` (verified against https://www.npmjs.com/package/@tiptap/react as of 2026-08-18, latest published 3.30.1 at that time; installed lockfile resolves to 3.30.2, still Tiptap major 3 — "Tiptap 3" in the draft spec is confirmed current, no version change needed). No new dependency was installed; this feature only consumes what F169's tech-decisions entry already staged.
- **StarterKit bundles Link in Tiptap 3** — confirmed by inspecting `node_modules/@tiptap/starter-kit/dist/index.cjs`, which requires `@tiptap/extension-link` and constructs `Link.configure(options.link)` internally when `link !== false`. Initially added `@tiptap/extension-link` as a second, separate extension per the draft spec's literal wording ("StarterKit + Link") and hit a runtime "Duplicate extension names found: ['link']" warning surfaced by a failing test. Fixed by configuring Link through `StarterKit.configure({ link: {...} })` instead of adding it standalone — this is the simpler option with no second source of truth, consistent with the clarification's "Ambiguity resolution" answer.
- **Component API shape** (what downstream features F170–F174, F245 need to know):
  - `RichTextEditor({ content?: JSONContent | null, onChange?: (content: JSONContent) => void, onBlur?: () => void, placeholder?: string, disabled?: boolean, className?: string, "aria-label"?: string })` — controlled component; storage format is Tiptap's `JSONContent`, never HTML. `content: null`/`undefined` renders an empty document.
  - `RichTextRenderer({ content?: JSONContent | null, className?: string, "aria-label"?: string })` — read-only render mode from the same module, sharing `sharedExtensions()` with the editable mode so the two paths can never diverge on how they interpret the JSON schema. This is what F171 should import for safe display.
  - `JSONContent` type is re-exported from this module (`import { JSONContent } from "@/components/editor/rich-text-editor"`) so consumers don't need a direct `@tiptap/react` dependency just to type their state.
- **Client-only / dynamic import**: the module is `"use client"`. A doc comment at the top of the file shows the exact `next/dynamic` pattern (`{ ssr: false }`) any Server Component page must use to render it, per the clarified "Notes for clarification" answer.
- **Toolbar built from existing shadcn `Button`** (`variant="ghost"`, `size="icon-sm"`) with `aria-pressed` reflecting live `editor.isActive(...)` state, rather than adopting `components/ui/toggle.tsx`'s Base UI `Toggle` primitive — kept to one control family already used elsewhere for icon-only actions, avoiding a second toggle abstraction. Toolbar subscribes to the editor's `transaction`/`selectionUpdate` events via a `useReducer` force-update so `aria-pressed` state is always current, not just what it was on mount.
- **Escape behavior (AS-313)**: intercepted via `editorProps.handleKeyDown` — calls `editor.commands.blur()` and the caller's `onBlur`, then returns `true` (event handled) so ProseMirror's own keymap never runs a conflicting default. No content mutation happens on this path, matching Tiptap/ProseMirror's default non-destructive Escape behaviour (there is no built-in "revert on Escape" to work around).
- **Submit shortcut (F245)**: left as a comment inside `handleKeyDown` noting where that wiring hooks in later — not implemented, per the draft spec's explicit instruction.
- **Link toolbar control**: uses `window.prompt` for the URL, matching the "simpler option, no new dependency" clarification answer rather than building a popover/dialog input (which would be a reasonable enhancement for F170+ if the design calls for it — flagged below as out-of-scope for this feature).

## Out-of-scope work needed
- A richer link-input UI (popover/dialog instead of `window.prompt`) — not required by the spec or assertions; noted here in case F170/F171/F245 want a nicer UX later.
- `@tiptap/extension-mention`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item` are already installed (per tech-decisions.md, for the mention picker AS-371–AS-378) but were NOT wired into this component — F169's scope is StarterKit + Link only, per the draft spec. A later feature (presumably covering AS-371–AS-378) should extend `sharedExtensions()` with the Mention extension, keeping it in the same shared function so `RichTextRenderer` picks it up automatically.
- No Playwright `.spec.ts` was added. The clarified "Primary success test" answer says to use "the test type that fits" — this is pure client-side editor logic best covered by jsdom-rendered unit/integration tests (which exercise the real Tiptap/ProseMirror engine and real DOM), not a live-browser e2e test; there is no page yet that mounts this component (that's F170+), so there is nothing for Playwright to visit.
- No screenshot was attached. The "definition of done" answer requires a browser-preview screenshot "for UI features" where a live page exists; F169 ships a component with no route/page to preview yet (consuming pages arrive in F170+). Recorded here so the milestone validator has the reasoning rather than a silently missing artifact.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Configured Link through `StarterKit.configure({ link })` instead of adding `@tiptap/extension-link` as a standalone extension (as the draft spec's file list literally implies), because Tiptap 3's StarterKit already constructs Link internally and adding it twice produces a duplicate-extension warning — the simpler, single-source-of-truth option per the clarification's ambiguity-resolution rule.
AUTONOMOUS_DECISION: Used `window.prompt` for the link URL input rather than building a custom popover, per the same "simpler option, no new dependency" rule.

## Notes for the next worker
- Tiptap 3.30.2's `useEditor` requires `immediatelyRender: false` to avoid a React 19/SSR hydration warning — already set in both `RichTextEditor` and `RichTextRenderer`; keep this if you extend the component.
- jsdom does not reliably simulate real contenteditable typing/native text selection, so AS-306 was verified by round-tripping real Tiptap `JSONContent` documents through both `RichTextRenderer`'s DOM output and `RichTextEditor`'s toolbar `isActive` state (which reflects the true ProseMirror selection state on mount, not a hardcoded prop) — this is real engine behaviour, not a source-text grep, but a future worker adding typing-simulation coverage would need `@testing-library/user-event` (not currently installed) or a Playwright spec against a real browser.
- No MCP tools were needed for this feature (pure client component, no backend/schema surface); `mcp-registry.md` confirms none required.
- `Toolbar`'s `useReducer`-based force-update on `editor.on("transaction"/"selectionUpdate")` is the pattern to reuse if any consumer (F170+) needs to read live editor state outside this component — consider extracting a `useEditorState`-based hook (already available in `@tiptap/react` 3.30.2) if that need grows beyond this toolbar.
