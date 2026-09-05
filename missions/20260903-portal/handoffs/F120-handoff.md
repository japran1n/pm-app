# Handoff: F120 — Three chat bugs found in testing right after the parity merge

## Status
COMPLETE

## Assertions covered
AS-070: PASS — already fixed by the concurrent pm-app-cf session before this feature started (commit 9bcd983, thread-panel.tsx's handleSend id-dedup guard). Verified present via code read; not re-implemented or re-tested per the coordinator's mid-task instruction. ChannelView's own equivalent guard was already correct.
AS-071: PASS — 6 tests in tests/unit/f120-chat-bugs.test.ts (pure-function autolinkBody cases + one sendMessage-integration test asserting the persisted body_json carries a real link mark for a bare URL with no trailing space).
AS-072: PASS — 5 tests covering the happy path (OG tags present), no-metadata failure path, network-failure path, non-2xx failure path, and the SSRF guard (localhost/private-IP/javascript: never reach fetch).
AS-073: PASS — 4 static class-chain assertions (jsdom has no real layout engine, so this checks the specific class combination the fix depends on rather than measured scroll geometry; documented as a known limitation below).

## Files changed
lib/chat/autolink-body.ts (new)
lib/chat/extract-links.ts (new)
lib/chat/link-preview.ts (new)
components/chat/link-preview-card.tsx (new)
components/chat/message-list.tsx
components/chat/thread-panel.tsx
lib/actions/chat-messages.ts
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/unit/f120-chat-bugs.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint <changed files>` (0, after fixing one set-state-in-effect error and one misplaced eslint-disable comment)
`npx vitest run tests/unit/chat-send-message-action.test.ts tests/unit/chat-mark-channel-read-action.test.ts tests/unit/chat-messages-realtime-subscription.test.ts tests/unit/chat-typing-channel.test.ts tests/unit/chat-unread-realtime-subscription.test.ts tests/unit/chat-workspace-channels-unread-count.test.ts tests/unit/f083-chat-delete-confirm.test.tsx tests/unit/rich-text-editor.test.tsx tests/unit/f120-chat-bugs.test.ts` (0 — 62/62 passed, no regressions in any existing chat suite)
`npx vitest run` (full suite, background) — a number of *integration* tests failed/timed out (recurrence-scheduled-generation, f327-project-lead-column-management, rls-saved-views, dependency-ui-actions, etc.) and `tests/unit/app-sidebar-project-nav-list.test.tsx` failed. None of these touch chat, none are files I changed (confirmed via `git status` — only chat-related files + the ones I edited are staged; app-sidebar.tsx/project-nav-list.tsx were already modified in the working tree by the concurrent F119 worker before I started, not by me). These read as pre-existing DB-timing/live-Supabase-dependent flakiness and F119's own in-progress work, not something this feature introduced.

## Decisions made
- AS-071 root cause: confirmed by reading the installed `@tiptap/extension-link@3.30.2` source directly (node_modules/@tiptap/extension-link/dist/index.cjs) — its `autolink()` plugin's `appendTransaction` bails out early unless the changed range's trailing text is already whitespace. A URL typed/pasted and sent immediately (Enter, no trailing space) never satisfies that, so the composer's own Tiptap editor state can carry a completely unmarked bare URL even though nothing else is "wrong." Fixed by adding a second, independent autolink pass (`lib/chat/autolink-body.ts`, plain regex-based, no new dependency) that runs server-side in `sendMessage`/`editMessage` before the body is persisted — this also covers the composer's plain-`<textarea>` fallback path (before the rich editor lazy-loads) which never carries marks at all.
- Did not import `linkifyjs` directly (it's only a transitive dependency of `@tiptap/extension-link`, not declared in package.json) — wrote a small `http(s)://`-only regex instead, matching `rich-text-editor.tsx`'s own `ALLOWED_LINK_PROTOCOLS` allow-list (no bare-`www.` heuristic, no `mailto:` autodetect — both would need judgment calls outside this bug fix's scope).
- AS-072 implemented as the spec's explicitly-sanctioned "straightforward synchronous-fetch-with-timeout version" — no persistent `link_previews` cache table, no per-workspace rate limit, no DNS-resolution-based SSRF hardening (only hostname/literal-IP string checks, which cannot catch DNS rebinding). Documented as the "hardened version" gap list inside `lib/chat/link-preview.ts`'s own doc comment.
- AS-073: root-caused (per the coordinator's lead) to `app/(workspace)/w/[workspaceSlug]/layout.tsx`'s outer shell using `min-h-svh` (a floor, not a cap) plus an unbounded `<main overflow-y-auto>`. Fixed with `h-svh` + `min-h-0` on `<main>`, NOT by removing `<main>`'s own `overflow-y-auto` — every other (non-chat) route in this app relies on that as its own page-level scroll fallback, and removing it would have been a much larger blast-radius change outside this feature's scope. This keeps that fallback but properly bounds it, so it only activates when a route hasn't already claimed internal scrolling the way ChannelView/MessageList do.
- AS-073's own test is a static class-string assertion, not a real browser-layout test — jsdom has no layout engine (documented precedent: this repo's own `tests/unit/rich-text-editor.test.tsx` doc comment states typing simulation/real layout isn't reliable in jsdom either). A true regression test would need Playwright/a real browser, which is out of this feature's tooling. Flagged explicitly in "Out-of-scope work needed" below.
- Left `components/nav/app-sidebar.tsx` and `components/portal/*` untouched per the spec's explicit out-of-scope list, even though `app-sidebar.tsx` was already modified in the working tree by the concurrent F119 worker when I started — did not touch it.
- AS-070 was resolved by the other session before I started meaningful work on it; per the coordinator's mid-task correction, I verified the fix (thread-panel.tsx's `handleSend` now has the same `previous.some(...)` id-dedup guard as ChannelView's) but did not re-implement or add a duplicate test for it.

## Out-of-scope work needed
- A real browser/Playwright-based regression test for AS-073 (scroll-container geometry) — this feature's static class-chain test guards against reverting the specific fix but cannot catch a *different* future double-scroll regression the way an actual rendered-layout assertion could.
- AS-072 hardening: persistent `link_previews` cache table (currently only an in-tab `Map`, re-fetches per page load/session), per-workspace rate limiting on the OG fetch, and real DNS-resolution-based SSRF protection (current guard is hostname/literal-IP string matching only — vulnerable to DNS rebinding). Explicitly called out as acceptable scope-limiting by the F120 spec itself ("ship a straightforward synchronous-fetch-with-timeout version and say in the handoff what a hardened version would additionally need").
- The `docs/chat-slack-parity-plan.md` plan doc lists many other chat gaps (DM UI, notification sound/preferences, full emoji picker, etc.) that were explicitly out of scope for this bug-fix feature — not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied the AS-071 autolink fix server-side (in the two Server Actions) rather than purely client-side (e.g. forcing Tiptap's autolink to also run on blur/submit) — this is the only fix point that also covers the plain-`<textarea>` fallback composer path and any other current/future caller of `sendMessage`/`editMessage`, giving one source of truth rather than two autolink implementations that could drift.
AUTONOMOUS_DECISION: Chose to keep `<main>`'s `overflow-y-auto` in the workspace layout rather than remove it, since it's shared by every route in the app, not just chat — removing it outright would have been a much bigger, riskier change than this bug-fix feature's scope, and bounding it correctly (h-svh + min-h-0) achieves the same effect for the chat route specifically without touching any other page's behavior.

## Notes for the next worker
- `lib/chat/autolink-body.ts` and `lib/chat/extract-links.ts` are pure functions with no server/client boundary requirements — safe to reuse from anywhere that needs "does this message have a link" (e.g. a future search/filter feature).
- `lib/chat/link-preview.ts` is a Server Action (`"use server"` at the top of the file, not per-export) — call it directly from a Client Component the same way `getLinkPreview(url)` is called in `components/chat/link-preview-card.tsx`.
- If a future feature adds the suggested `link_previews` cache table, `LinkPreviewCard`'s in-tab `Map` cache can be deleted entirely — the module-level cache there exists only to avoid re-fetching the same URL within one page session, since there's no server-side cache yet.
- No MCP tools were used for this feature — everything here is application code (Server Actions, React components, a layout CSS fix); no live external-service schema/config needed inspecting per `mcp-registry.md`.
