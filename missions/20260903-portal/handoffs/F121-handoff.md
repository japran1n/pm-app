# Handoff: F121 — Links render but are inert

## Status
COMPLETE

## Assertions covered
AS-074: PASS — `tests/unit/f121-links-inert-in-renderer.test.tsx` (5 tests). Rendered link in `RichTextRenderer` has correct `href`, `target="_blank"`, `rel` containing `noopener`/`noreferrer`, lives inside `.rich-text-renderer` which now has a scoped CSS rule (colour + underline via `var(--primary)`), and a structural check confirms `RichTextEditor`'s call site never passes `linksClickable: true` while `RichTextRenderer`'s does — so the editable editor's `StarterKit` `link.openOnClick` still resolves to `false`, unchanged.
AS-075: PASS — `file components/editor/rich-text-editor.tsx` now reports `Unicode text, UTF-8 text` (verified both manually and in a test; the test only asserts the output contains "text" and not "data", to stay robust across `file` versions/locales), and `grep -c "openOnClick" components/editor/rich-text-editor.tsx` (no `-a`) returns a non-zero count.

## Files changed
components/editor/rich-text-editor.tsx
app/globals.css
tests/unit/f121-links-inert-in-renderer.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/editor/rich-text-editor.tsx app/globals.css tests/unit/f121-links-inert-in-renderer.test.tsx` (0 errors — one unrelated "no matching configuration" warning for globals.css, which is a CSS file eslint doesn't lint)
`npx vitest run tests/unit/f121-links-inert-in-renderer.test.tsx tests/unit/editor-paste-rules.test.ts tests/unit/mention-extension.test.tsx tests/unit/f120-chat-bugs.test.ts tests/unit/rich-text-renderer-sanitisation.test.tsx tests/unit/clipboard-image-paste.test.tsx tests/unit/mention-picker-narrowing.test.tsx tests/unit/editor-task-list-checkboxes.test.tsx tests/unit/rich-text-editor.test.tsx tests/integration/comment-format-realtime.test.ts` (0 — 97/97 passed)
`npx vitest run` (full suite, attempted twice, both killed after ~2+ min) — `tests/integration/f002-phase-management.test.ts` and several other DB/network-dependent integration suites fail with `no active request/render context (expected in tests)` and similar pre-existing errors unrelated to anything touched here (none of those files are in "Files changed" above); F120's own handoff documents the same category of pre-existing full-suite flakiness. Scoped test run above is the reliable signal for this feature.

## Decisions made
- Added a `linksClickable` boolean option to `sharedExtensions()` (same pattern as the existing `onReadOnlyChecked`/`getMentionItems` options) rather than forking the extension list between the two callers, per the spec's explicit instruction to extend the options object in the same style.
- `RichTextRenderer` passes `linksClickable: true`; `RichTextEditor` does not pass it at all (defaults to `false`), so `StarterKit.configure({ link: { openOnClick: linksClickable } })` preserves the exact prior behaviour for the editable editor.
- Used Tiptap's own `Link` extension `HTMLAttributes` config (`target: "_blank"`, `rel: "noopener noreferrer"`) rather than a custom click handler, per the spec's instruction to use the extension's own options.
- Styling added as `.rich-text-renderer a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }`, scoped to the renderer only, using the existing `--primary` CSS-variable token (already themed for light/dark elsewhere in `globals.css`) rather than a hardcoded hex — inherits correct contrast in both themes automatically.
- AS-075 fix: replaced the raw NUL (`\x00`) and DEL (`\x7F`) bytes inside `sanitiseHref`'s regex character class with the literal escape sequences `\x00-\x1F\x7F\s`, confirmed byte-for-byte equivalent behaviour (same Unicode code points matched) and re-ran the existing sanitisation test suite (`rich-text-renderer-sanitisation.test.tsx`) unchanged and still passing, since I did not touch `sanitiseHref`'s logic, only its literal source encoding.
- Test for the "editable editor's click behaviour is unchanged" half of AS-074 uses a structural source-text check (confirming `RichTextEditor`'s code path never opts into `linksClickable: true`) instead of a jsdom DOM-click simulation, because Tiptap's `openOnClick: false` inertness is enforced by browsers' native "no-navigate-on-click-inside-contenteditable" behaviour, which jsdom does not implement (verified by reading `@tiptap/extension-link`'s `clickHandler` source in `node_modules` — it only calls `window.open()` when `openOnClick` is true, and never calls `preventDefault()` when false, relying on the browser's contenteditable click default). Also added a DOM-level assertion that the editable editor still renders the anchor at all, so formatting itself isn't broken.

## Out-of-scope work needed
- Old messages/comments/descriptions sent before F120 shipped genuinely have no `link` mark in their stored `body_json`; they will keep rendering as plain, non-clickable text. Per the spec, this is expected and explicitly NOT to be fixed with a backfill migration here.
- A real browser/Playwright-based test to directly observe "click does not navigate" for the editable editor (jsdom cannot exercise the native contenteditable-click-inertness this relies on) — same category of gap F120's handoff already flagged for AS-073's scroll geometry.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new `sharedExtensions()` option `linksClickable` (spec left the exact name unspecified, just said "add an option in the same style"), chosen because it names the caller-visible behaviour delta rather than mirroring the underlying Tiptap prop name (`openOnClick`), so a future reader doesn't have to know Tiptap's API to guess what it does.

## Notes for the next worker
- Verified manually against the running dev server (localhost:3000, already running, not restarted): sent a chat message containing `https://example.com` and confirmed it renders underlined in the theme's primary colour and opens the URL in a new tab on click.
- No MCP tools used — this is pure application code (a shared editor/renderer component + one CSS rule), no live external-service schema/config to introspect per `mcp-registry.md`.
- `file components/editor/rich-text-editor.tsx` before this fix reported `data`; grep without `-a` returned zero matches anywhere in the file (confirmed the exact symptom the spec described) — after the fix it reports `Unicode text, UTF-8 text` and ordinary `grep` works normally again.
