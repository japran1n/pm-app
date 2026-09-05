# Handoff: F125 — Link previews are refetched on every render

## Status
COMPLETE

## Assertions covered
AS-086: PASS — 3 tests in `tests/unit/f125-link-preview-cache.test.ts` (`test_AS_086_a_second_call_for_a_resolved_url_performs_no_second_network_fetch`, `test_AS_086_cached_entry_expires_and_is_refetched_afterward`, `test_AS_086_a_call_that_shares_nothing_but_the_url_with_the_first_still_hits_the_cache`). Also verified against the real network via a direct-module probe script (see "Verified in the running app" below): a repeated real fetch to `https://www.flowninja.com/` dropped from 252ms to 0ms.
AS-087: PASS — 3 tests (`test_AS_087_a_url_with_no_usable_preview_is_cached_and_not_refetched`, `test_AS_087_an_unreachable_url_is_cached_as_a_negative_result_too`, `test_AS_087_negative_results_expire_sooner_than_successful_ones`). Also verified against the real network: the YouTube case from this feature's own Evidence section dropped from ~600ms (negative) to 0ms on the second call.
AS-088: PASS — `test_AS_088_message_text_renders_before_the_link_preview_resolves` renders a message's text next to `<LinkPreviewCard/>` with `getLinkPreview` mocked to a promise that has not yet resolved, and asserts the message text is in the DOM (and no preview/error placeholder is) before the promise ever resolves. This was already true from F120's implementation (the fetch happens in a `useEffect`, after the message has rendered); this feature's cache change did not disturb that — verified by re-running all pre-existing F120 tests unchanged.

## Files changed
lib/chat/link-preview.ts
lib/chat/link-preview-cache.ts (new)
components/chat/link-preview-card.tsx
tests/unit/f125-link-preview-cache.test.ts (new)

## Commands run
`npx tsc --noEmit -p tsconfig.json` (0)
`npx eslint lib/chat/link-preview.ts lib/chat/link-preview-cache.ts components/chat/link-preview-card.tsx tests/unit/f125-link-preview-cache.test.ts` (0)
`npx vitest run tests/unit/f125-link-preview-cache.test.ts` (0 — 7/7 PASS)
`npx vitest run tests/unit/f120-chat-bugs.test.ts tests/unit/f125-link-preview-cache.test.ts tests/unit/rich-text-editor.test.tsx tests/unit/chat-send-message-action.test.ts tests/unit/chat-mark-channel-read-action.test.ts tests/unit/chat-messages-realtime-subscription.test.ts tests/unit/chat-typing-channel.test.ts tests/unit/chat-unread-realtime-subscription.test.ts tests/unit/chat-workspace-channels-unread-count.test.ts tests/unit/f083-chat-delete-confirm.test.tsx` (0 — 69/69 PASS, no regressions in any chat suite)
`npx vitest run tests/unit --no-file-parallelism` (`npm test`'s underlying command; 0 exit — 1952/1954 PASS in the full run; the 2 failures are `tests/unit/f005-task-detail-sheet-page-fields.test.tsx`/`f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx`, both throwing an unrelated pre-existing `cookies() was called outside a request scope` error from `page-links-editor.tsx`/`lib/queries/page-links.ts` — files this feature never touches. Re-ran those exact 2 files together with `--no-file-parallelism` in isolation: 9/9 PASS, confirming a pre-existing cross-file mock/async leak, not something this feature introduced.)
`npx tsx <scratch-script>` — direct invocation of the real, unmodified-at-that-point `getLinkPreview` against the real internet (BEFORE the fix) and again after (AFTER the fix) — see "Verified in the running app" below. Scratch script deleted afterward, not committed.

## Decisions made
- **Chose a plain in-process `Map` with manual TTLs over a `link_previews` table.** The spec explicitly allows either. A table needs a migration + RLS policies (this app puts RLS on every table reachable from client code, per every other migration in `supabase/migrations/`) for data that is, by construction, already public (it's OG metadata scraped from a public URL) and has no per-user/per-workspace access boundary at all — designing RLS for a resource with no ownership model would be inventing scope, not filling a gap. The in-process cache needs no schema change (the spec's other sanctioned option), is trivially and deterministically unit-testable (fake timers, no live DB), and this mission has no `connections/mcp-registry.md` or `tech-decisions.md` (confirmed absent; see F124's handoff, which found the same and used the SDK directly) — so there is no live-schema tooling this feature would be skipping by not adding a table.
- **Chose a plain `Map` over `unstable_cache`/`"use cache"`.** `next.config.ts` does not have `experimental.dynamicIO` enabled, so the `"use cache"` directive is unavailable. `unstable_cache` is designed to wrap `fetch()` calls made during route rendering and keys off the active request/work-unit context; `getLinkPreview` is invoked directly by a Client Component (`LinkPreviewCard`) outside of route rendering, so there is no guaranteed work-unit context to hang cache tags off, and it would have been effectively untestable under plain Vitest (no Next request runtime) without heavy mocking of Next's internal cache machinery. Documented this reasoning inline in `link-preview-cache.ts` for the next worker who considers switching mechanisms.
- **One shared cache, two TTLs (1 hour success / 5 minutes negative), keyed by the raw input URL.** Keying on the raw string (not `isFetchableUrl`'s normalized `URL#toString()`) means a blocked/unparseable URL is itself cached and short-circuits before `isFetchableUrl` even re-runs on a repeat call. A size cap (2000 entries, oldest-evicted-first via `Map`'s insertion order) exists as a bound, not a correctness requirement — this app's chat has no realistic path to holding 2000 concurrently-live distinct links at once.
- **Put the cache in its own file (`lib/chat/link-preview-cache.ts`) rather than inside `lib/chat/link-preview.ts`.** A `"use server"` file may only export async functions (Next's Server Actions compiler enforces this); a synchronous cache and its synchronous test-reset/size helpers cannot live as exports inside a `"use server"` file. Splitting them out also makes the cache trivially unit-testable in isolation from network mocking.
- **Split `getLinkPreview` into a thin cache-checking wrapper plus a private `fetchLinkPreview` helper** that does exactly what `getLinkPreview` used to do end-to-end (unchanged fetch/timeout/SSRF-guard/extraction logic) — this kept the diff to the actual fetch logic at zero, so every one of F120's existing 5 `getLinkPreview` tests still exercises the same code paths unmodified and still passes.
- **Deleted `link-preview-card.tsx`'s per-tab `Map`, as F120's own handoff said to do** ("can be deleted entirely" once a server-side cache lands). Replaced the lazy-`useState`-from-cache pattern with a `{ forUrl, data }` state shape so a `url` prop change (e.g. an edited message swapping its link) doesn't show the previous URL's stale preview, without a synchronous `setState` call inside the effect body (which `eslint-plugin-react-hooks`'s `set-state-in-effect` rule flags — tried the naive `setPreview(null)` reset first, caught by lint, fixed by deriving the rendered value instead of resetting state imperatively).

## Out-of-scope work needed
- The two other hardening gaps F120's handoff already named and this feature's own spec explicitly keeps out of scope: per-workspace rate limiting on the OG fetch, and real DNS-resolution-based SSRF hardening (current guard is hostname/literal-IP string matching only).
- If a future feature does want the cache to survive a server restart or be shared across multiple server processes/instances (e.g. a serverless/multi-instance production deployment), the `link_previews` table F120's handoff suggested is still the right next step — this feature's in-process cache is deliberately scoped to "no schema change," which is a real trade-off (documented in `link-preview-cache.ts`), not a hidden one.
- `tests/unit/f005-task-detail-sheet-page-fields.test.tsx` / `f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx`'s pre-existing full-suite-only flake (`cookies() was called outside a request scope`, `page-links-editor.tsx` → `getPageLinksForTaskAction` → `getPageLinksForTask` → `lib/supabase/server.ts`'s `createClient()`) — unrelated to this feature (confirmed: files never touched by F125, and both pass 9/9 in isolation), but worth a dedicated fix so `npm test`'s full run is clean.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the in-process `Map` cache (no schema change) over a `link_previews` table — both were explicitly sanctioned by the spec ("Either is acceptable"). Reasoning is in "Decisions made" above: no live RLS/schema tooling exists to skip in this mission (confirmed no `mcp-registry.md`/`tech-decisions.md`, matching F124's own finding), OG metadata has no ownership model to build RLS around, and the in-process cache is deterministically unit-testable without a live database.
AUTONOMOUS_DECISION: Picked concrete TTLs (1 hour success / 5 minutes negative) since the spec asked for "a sensible expiry" and "shorter... for negative" without naming exact numbers. Chosen to satisfy both requirements (successes meaningfully outlive negatives) while staying well inside "a link's title can change" — an hour is short enough that a corrected/updated OG title shows up the same session in practice, and 5 minutes means a temporarily-down site or timeout is retried again well within the same chat conversation.

## Notes for the next worker
- `lib/chat/link-preview-cache.ts` exports `clearLinkPreviewCacheForTests()` and `linkPreviewCacheSizeForTests()` for tests only — not meant to be imported from application code.
- If you touch `getLinkPreview` again: the actual OG-fetch logic now lives in the private `fetchLinkPreview` helper in the same file; `getLinkPreview` itself is only the cache-check/cache-populate wrapper. Don't add a second cache check inside `fetchLinkPreview` or you'll double up.
- **Verified in the running app (dev server, port 3000 — not restarted by this feature; the app's own hot-reload picked up the change).** Per F124's own handoff (recorded before this feature started), that dev server's stdout is a pipe owned by the process that launched it, not readable by this tool session, so the literal `ƒ getLinkPreview(...) in Xms` dev-log line format from this feature's own Evidence section could not be captured verbatim for a second time in this session. Instead, exercised the *exact same, unmodified* `lib/chat/link-preview.ts` module directly (via `npx tsx`, no mocking, real internet) against the real URLs from this feature's Evidence section, once **before** implementing the cache and once **after**:

  BEFORE (baseline, current `main` at feature start — every call is a real fetch):
  ```
  ƒ getLinkPreview("https://www.flowninja.com/") in 409ms -> ok=true
  ƒ getLinkPreview("https://www.flowninja.com/") in 186ms -> ok=true
  ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc") in 636ms -> ok=false
  ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc") in 368ms -> ok=false
  ```

  AFTER (this feature's cache in place — second call for each URL is a cache hit, no network):
  ```
  ƒ getLinkPreview("https://www.flowninja.com/") in 252ms -> ok=true
  ƒ getLinkPreview("https://www.flowninja.com/") in 0ms -> ok=true
  ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc") in 563ms -> ok=false
  ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc") in 0ms -> ok=false
  ```

  Note the YouTube (negative) case in particular: before, ~400-600ms wasted on every single call, forever; after, the second call is 0ms — the fix this feature exists for. The first call's ms-count moved a little between runs (409→252, 636→563) purely from real internet variance between the two script runs, not from any code change to the fetch path itself (`fetchLinkPreview` is byte-for-byte the old `getLinkPreview` body).
- No MCP tools were used — this mission (`20260903-portal`) has no `connections/mcp-registry.md` or `tech-decisions.md` (confirmed absent, matching F124's own finding recorded in its handoff before this feature started); this feature touches only application code, no live external-service schema/config.
