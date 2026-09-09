# Handoff: F026 — Stop leaking error text; fix search query construction

## Status
COMPLETE

## Assertions covered
AS-105: PASS — new test `test_AS_105_thrown_tool_error_message_never_reaches_the_client` in tests/integration/f007-docs-agent-route.test.ts asserts the raw `response.text()` NDJSON string never contains a unique marker embedded in a thrown tool error. Confirmed this test FAILS against the pre-fix `route.ts` (marker appeared in the `detail` field) and PASSES after the fix.
AS-041: PASS — existing `test_AS_041_every_line_is_exactly_one_valid_json_object` still green; unaffected by these changes.
AS-022: PASS — `test_AS_022_happy_path_returns_shaped_results_capped_at_10` in lib/ai/tools/__tests__/search-docs.test.ts, updated for the new two-query `.ilike()` mock shape, still green (10 results capped from 15).
AS-043: PASS — existing `test_AS_043_a_proposal_result_ends_the_turn_immediately` still green after switching proposal detection to a tool-name allowlist (the test's tool is named `propose_doc_edit`, which is in the allowlist).

## Files changed
app/api/ai/docs/route.ts
lib/ai/tools/search-docs.ts
lib/ai/tools/__tests__/search-docs.test.ts
tests/integration/f007-docs-agent-route.test.ts

## Commands run
`npx tsc --noEmit` (0; 4 pre-existing errors in app/layout.tsx, components/ui/status-badge.tsx, tests/unit/docs-markdown-editor-export-import.test.tsx — none touched by this feature, none new)
`npx eslint .` (0; 26 pre-existing warnings, none new)
`npx vitest run lib/` (0; 74/74 passed — was 70/70 before this feature, +4 new tests in search-docs.test.ts)
`npx vitest run tests/integration/f007-docs-agent-route.test.ts` (0; 12/12 passed — was 11/11 before this feature, +1 new AS-105 test)
`git stash push -- app/api/ai/docs/route.ts lib/ai/tools/search-docs.ts && npx vitest run tests/integration/f007-docs-agent-route.test.ts -t AS_105` (1; confirmed the new AS-105 test FAILS against pre-fix route.ts, then `git stash pop` restored the fix)
`node -e '...'` one-off script confirming the pre-fix `.or()` string-interpolation approach turns `"budget, revised"` into `title.ilike.%budget, revised%,content.ilike.%budget, revised%` — an extra top-level OR term via the unescaped comma, the exact injection M1d describes.

## Decisions made
- M1a: kept the generic `"Tool execution failed."` summary string already used for the non-existent-tool branch, for consistency, rather than inventing new wording. The actual thrown message is now logged server-side only via `logger.error(..., { detail: ... })`.
- M1a (route.ts:394 unexpected-error branch): per spec, dropped `error.message` from the log line too (not just the wire), logging `error.name` instead as a safe correlation hint. This is a stricter posture than "log everything server-side" but matches the spec's explicit instruction to remove it from that specific log call.
- M1d: chose the "two bound `.ilike()` queries merged client-side" restructuring option explicitly offered in the spec, over rebuilding an escaped `.or()` string, because it fully eliminates the injection surface (no filter-string interpolation of any kind) rather than just improving the escaping. Added `.order("id", { ascending: true })` to each sub-query for determinism, then re-sorted the merged, deduped set by id and sliced to `MAX_RESULTS` before mapping to the response shape — this preserves the "top MAX_RESULTS documents, deterministic" contract even after merging two independently-capped queries.
- M1f: allowlist is `{"propose_doc_edit", "create_doc"}`, exactly the two tool names cited in the spec (F014/F017, not yet registered — inert today, this is forward preparation only).
- Rewrote lib/ai/tools/__tests__/search-docs.test.ts's Supabase mock to model the new `.ilike(column, pattern).order(...).limit(...)` chain (one mock builder invocation per column) instead of the old `.or(...).limit(...)` chain, since the old mock shape no longer matches the implementation's actual call sequence. Added two new tests: one asserting the query builder never sees a hand-built filter string containing unescaped grammar characters (asserts the `.ilike()` pattern argument passed through verbatim rather than being spliced into an `.or()` string), and one asserting a comma-containing query still returns the expected single result rather than erroring or duplicating.

## Out-of-scope work needed
- None identified beyond what F026 already scopes. The two allowlisted tool names (`propose_doc_edit`, `create_doc`) are not yet registered anywhere in the tool registry (F014/F017) — that registration is explicitly out of scope for F026 per the spec ("inert today").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the route.ts:394 unexpected-error log line, chose to log `error.name` (e.g. "TypeError") instead of omitting the field entirely, to preserve some server-side debuggability without reintroducing the message-leak pattern the spec is closing out. The spec only said to "drop error.message"; it didn't say what if anything to log in its place, so I picked the smallest safe substitute.

## Notes for the next worker
- The AS-105 test's proof-of-failure was verified by `git stash push` on only the two implementation files (route.ts, search-docs.ts) while keeping the new test file in place, then running the new test in isolation, then `git stash pop`. This is recorded verbatim in "Commands run" above.
- lib/ai/tools/__tests__/search-docs.test.ts's mock now returns a fresh `order`/`limit` `vi.fn()` per `.ilike()` invocation (per-column), so assertions like `mockIlike.mock.results[0].value.order` are the way to reach those nested spies — a flat shared `mockOrder`/`mockLimit` across columns is not accurate to the real per-column-query shape being tested.
- Did not touch `handleUpstreamError`'s `APIError`/`RateLimitError` branches — those already only send generic, hardcoded messages (verified while reading route.ts) and were not part of the three cited defects.
