# Handoff: F123 — Rich text crosses the server-action boundary as a client reference

## Status
COMPLETE

## Assertions covered
AS-079: PASS — `tests/unit/f123-message-composer-plain-json-boundary.test.tsx` (`test_AS_079_composer_serialises_rich_body_to_plain_json_before_onSend`). Confirmed the test fails without the fix (see Commands run — reverted the composer change via `git stash`, re-ran, got the expected `not.toBe` assertion failure), and passes with it.
AS-080: PASS — verified end-to-end against the real running dev server (localhost:3000, not a second instance) with a throwaway seeded workspace/channel/user (Supabase admin client, magic-link auth via Playwright, same technique `tests/e2e/dependency-ui.spec.ts` established): sent a real message containing a bare URL through the real composer UI. All three required checks passed:
  a) no runtime error — no error overlay, no "Cannot access href on the server" text, and the only console/page errors captured were a pre-existing, unrelated hydration-mismatch warning (`caret-color` on a search `<input>`, present on this page regardless of chat) — not present in relation to sending.
  b) the stored `messages.body_json` row (queried via `node --env-file=.env` against the REST API using `SUPABASE_SECRET_KEY`, per this feature's explicit instruction — the Supabase MCP server is not authenticated in this environment) carries a real `href`: `{"type":"link","attrs":{"href":"https://example.com/f123-e2e-test", ...}}`.
  c) the rendered DOM contains `<a href="https://example.com/f123-e2e-test">`.
  All temporary seed data (workspace, channel, channel member, workspace member, message, auth user) was deleted after the run; nothing left behind in the database.

## Files changed
components/chat/message-composer.tsx
tests/unit/f123-message-composer-plain-json-boundary.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/chat/message-composer.tsx tests/unit/f123-message-composer-plain-json-boundary.test.tsx` (0)
`npx vitest run tests/unit/rich-text-editor.test.tsx tests/unit/f120-chat-bugs.test.ts tests/unit/f121-links-inert-in-renderer.test.tsx tests/unit/f122-link-mark-without-href.test.tsx tests/unit/f123-message-composer-plain-json-boundary.test.tsx` (0 — 41/41 passed)
`npx vitest run tests/unit` (0 for the suite as a whole; 1936/1938 passed, 2 pre-existing unrelated failures — see below)
`git stash push -- components/chat/message-composer.tsx && npx vitest run tests/unit/f123-message-composer-plain-json-boundary.test.tsx && git stash pop` — confirmed the new test FAILS without the fix (`expected {...} not to be {...}` on the `attrs` reference-identity assertion), then restored the fix.
A throwaway Node+Playwright script (not committed, deleted before exit) that: seeded a workspace/channel/user via `@supabase/supabase-js` admin client (`SUPABASE_SECRET_KEY`), signed in via a real magic link + cookie injection into the real running dev server on port 3000 (same technique as `tests/e2e/dependency-ui.spec.ts`), typed a bare URL into the real composer, pressed Enter, and checked (a) no runtime error, (b) live REST query of `messages.body_json`, (c) DOM `<a href>`. Cleaned up all seeded rows/users afterward via the same admin client.

Pre-existing failures in the full `tests/unit` run (both present before this feature, confirmed by F122's own handoff which documents the identical failure): `tests/unit/f005-task-detail-sheet-page-fields.test.tsx` and `tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx` — an unhandled rejection from `cookies() was called outside a request scope` in `lib/queries/page-links.ts`/`lib/supabase/server.ts`, unrelated to chat/rich-text/links. Both pass in isolation.

## Decisions made
- Applied `toPlainJson` (already defined in `lib/comments/rich-text.ts`, a pure `JSON.parse(JSON.stringify(...))` round-trip) inside `message-composer.tsx`'s `submit()`, at the point `richValueRef.current` is read to build `bodyJson` — i.e. on the CLIENT, immediately before the value is handed to `onSend` (which calls the `sendMessage` server action). This is the same pattern `components/task/comment-list.tsx` (F339) and `components/task/task-detail-sheet.tsx` (F340) already use for the identical bug class — reused the existing helper rather than writing a second serialiser, per the spec's explicit instruction.
- Checked every other rich-text-to-server-action caller in the codebase for the same latent bug, per the spec's scope item 2:
  - `components/task/comment-list.tsx` (add + edit comment) — already safe. Both call sites (`toPlainJson(draft)` and `toPlainJson(editDraft)`) already wrap the live Tiptap document before crossing the `addComment`/`editComment` server-action boundary — fixed previously under F339 (see that fix's doc comment in the file, which independently reproduced and diagnosed the exact same "temporary client reference" mechanism this feature diagnoses for chat).
  - `components/task/task-detail-sheet.tsx` (task description edit) — already safe. `toPlainJson(next)` is applied immediately before `editTask(...)`'s server-action call — fixed previously under F340 (same bug class, same fix pattern, documented in that file's own comment).
  - `components/chat/message-list.tsx`'s inline message-edit path (`editMessage(message.id, docFromPlainText(trimmed))`) — safe by construction, not because of a round-trip: `docFromPlainText` builds a brand-new plain object literal from a plain string; it never touches a live ProseMirror/Tiptap document reference, so there is no live reference to sever in the first place.
  - `components/chat/message-composer.tsx` (this feature's actual bug) — was NOT safe before this fix: `submit()` read `richValueRef.current`, Tiptap's own live `JSONContent`, and passed it straight to `onSend` → `sendMessage`, uncloned.
  - Confirmed via `grep` across `components/` and `lib/actions` that these four call sites (comments add/edit, task description, chat send) are the complete set of places a live Tiptap/rich-text document crosses a Server Action boundary; no other caller was found.
- Did NOT touch `lib/chat/autolink-body.ts`'s `hasUsableLinkHref` (F122) — kept exactly as-is, per the spec's explicit "do not revert F122." Verified it is now called with real plain data (no client reference) and works correctly, both via the existing `f122-link-mark-without-href.test.tsx` suite (unchanged, still 100% passing) and via the live end-to-end run above, which produced a correctly-populated `href` with no runtime error.

## Out-of-scope work needed
- No backfill for messages already stored with href-less link marks from before F122/F123 landed (explicitly out of scope per the spec) — they will continue to render as plain text (F121's `sanitiseDocument` behaviour) until re-sent.
- Not touched, not needed: the renderer's sanitiser, link styling, OG previews (F120/F121, unaffected by this fix).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the live end-to-end verification, seeded a throwaway workspace/channel/user via the Supabase admin client rather than reusing an existing seeded workspace, to avoid leaving a test message in a real user-facing channel and to make cleanup trivial and complete (all seeded rows deleted in a `finally` block) — mirrors this repo's own established e2e-test seeding convention (`tests/e2e/dependency-ui.spec.ts`, `tests/e2e/subtask-ui.spec.ts`) rather than inventing a new one.
AUTONOMOUS_DECISION: Did not add this as a permanent `tests/e2e/*.spec.ts` Playwright spec (which would run in CI). The spec explicitly calls for one-off live verification with DB inspection via a raw REST query (not the Supabase MCP, unauthenticated here) — a permanent e2e spec would need its own CI credentials wiring, which is out of this feature's scope. The verification script itself was deleted after use per the "do not leave stray files" expectation for a worker's scratch tooling; the durable, re-runnable regression coverage for AS-079 lives in the new unit test instead.

## Notes for the next worker
- The live DB check hit one purely-environmental hiccup unrelated to the code: `getaddrinfo ENOTFOUND` for the Supabase host from a couple of ad-hoc `curl`/`node fetch` calls, which cleared itself up within a few seconds (confirmed the DNS record itself resolved fine throughout via `dig`/`nslookup`; a `curl --resolve` bypass worked immediately). Purely local resolver flakiness in this environment, not a code or infra issue — if a future worker's live-DB check intermittently fails with `ENOTFOUND`/`fetch failed`, retry once or twice before concluding anything is actually broken.
- A deliberate attempt to reproduce the ORIGINAL crash (temporarily `git stash`-ing just the composer fix, then re-running the same live browser script to see the "Cannot access href on the server" error fire for real) was started but hit the 2-minute tool timeout while the browser session was mid-flight, and was aborted before completing; the stash was correctly popped immediately afterward (verified: `git diff --stat` showed the fix intact, `git stash list` empty). I did not repeat this specific live-crash repro given the timeout risk, since the jsdom unit test (`test_AS_079_...`) already gives a fast, reliable, reproducible proof that this exact test fails without the fix (ran and captured that failure once, cleanly, via the same stash/pop technique without a live browser) — this is the artifact to trust for "does removing the fix reintroduce the bug," not the aborted live attempt.
- No MCP tools used — Supabase MCP is unauthenticated in this environment (consistent with F122's and other prior features' handoffs); used a raw `node --env-file=.env` REST query and the `@supabase/supabase-js` admin client instead, both read-only/cleanup-only, no credential values logged anywhere.
- `lib/comments/rich-text.ts`'s `toPlainJson` doc comment already has an excellent write-up of exactly why a plain `JSON.parse(JSON.stringify(...))` round-trip is the correct fix for this whole bug class (React Server Actions' "temporary client reference" encoding for values holding onto a live client-side object identity) — worth reading in full if this bug class resurfaces at a fifth call site.
