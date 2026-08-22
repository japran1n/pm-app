# Handoff: F172 — Paste behaviour (rich text editor)

## Status
COMPLETE

## Assertions covered
AS-308: PASS — pasted formatting is preserved where supported (bold/italic/headings/lists/code/links) and dropped-but-text-preserved where not (tables, Word/Google Docs wrapper spans, images without alt, script/style, javascript: links); verified with 9 passing unit tests in tests/unit/editor-paste-rules.test.ts, plus code-level reasoning for the Cmd/Ctrl+Shift+V plain-text override path (not independently simulatable in jsdom — see in-file comment).

## Files changed
lib/editor/paste-rules.ts
components/editor/rich-text-editor.tsx
tests/unit/editor-paste-rules.test.ts
missions/20260818-213033/handoffs/F172-handoff.md

## Commands run
`npx vitest run tests/unit/editor-paste-rules.test.ts` (0) — 9/9 passed
`npx tsc --noEmit` (0) — clean
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts)

## Decisions made
- Implemented paste degradation as a pure DOM-string transform (`transformPastedHtml` in lib/editor/paste-rules.ts) wired into Tiptap's `editorProps.transformPastedHTML`, rather than mutating ProseMirror's schema-parsing directly, so it can be unit-tested without a mounted editor and without a real browser paste event.
- Kept `transformPastedHtml` strictly upstream of, and non-duplicative with, F171's `sanitiseDocument` allow-list: `sanitiseDocument` remains the single security boundary for all JSONContent (typed, pasted, or loaded from storage); this module only pre-shapes clipboard HTML so ProseMirror's own parser doesn't silently drop text for unrecognised elements.
- Rule for unsupported markup: strip only the *styling* (tag), never the *words* — unsupported elements are unwrapped and their text content kept as plain text (tables, Word/Google Docs `mso-*` wrapper spans, unsafe-protocol links). Truly non-textual/executable payload (`script`, `style`, `head`, `title`, `meta`, `link`) is dropped entirely including its text.
- `<img>` degrades to its `alt` text only (if present); the image itself never survives, matching the "words survive, styling doesn't" rule while never re-hosting or trusting an external `src`.
- Link hrefs are allow-listed to `http(s):`/`mailto:` protocols; anything else (e.g. `javascript:`) causes the anchor to degrade to its plain text content rather than emit a dangling or unsafe link.
- Cmd/Ctrl+Shift+V ("paste as plain text") implemented via a ref (not React state) set on `handleKeyDown` and consumed by `handlePaste`, since native `paste` events don't expose modifier key state and a ref avoids an unnecessary re-render mid-keystroke.
- No MCP usage — this feature is pure client-side editor logic with no external service or live schema/data involved (mcp-registry.md has no relevant row).

## Out-of-scope work needed
None identified specific to F172. (Pre-existing unrelated lint warnings noted above are out of scope for this feature and were not touched.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The Cmd/Ctrl+Shift+V plain-text-paste override's ProseMirror `handlePaste` interception isn't independently verifiable via jsdom (no real focused contenteditable + native ClipboardEvent, consistent with the existing documented limitation for AS-306 typing simulation in tests/unit/rich-text-editor.test.tsx). Verified instead by proving the override path's actual behaviour — reading only `text/plain` and never touching `text/html` — cannot produce markup regardless of clipboard richness, which is exactly what AS-308 asks for on that path.

## Notes for the next worker
- `INLINE_TAG_ALIASES` / `BLOCK_TAGS` in lib/editor/paste-rules.ts are manually kept in sync with `ALLOWED_NODE_TYPES` / `ALLOWED_MARK_TYPES` in components/editor/rich-text-editor.tsx (HTML tag names vs Tiptap JSON node/mark type names don't share a common enum). If F171's allow-list changes, update this file's tag sets to match.
- Interrupted by a transient API error mid-task on a prior attempt; work was already staged intact (verified via `git diff --cached` and file reads) before finishing this handoff — no code was rewritten in this session, only verified and documented.
- Did not touch or stage any files belonging to the concurrently-active F174 worker (components/task/comment-list.tsx, lib/actions/comments.ts, lib/supabase/database.types.ts, lib/tasks/reconcile-realtime-comment.ts, lib/validation/comments.ts, lib/comments/, supabase/migrations/20260822100000_comment_body_json.sql) — confirmed via `git status` these remain unstaged/untracked and were left as-is.
