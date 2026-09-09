# Handoff: F033 — Make tool results real

## Status
COMPLETE

## Assertions covered
AS-063: PASS — verified by running `npx vitest run tests/integration/f007-docs-agent-route.test.ts tests/unit/f011-tool-call-card.test.tsx` (all green) AND by the mutation check below: reverting the route's success `tool_end` back to `summary: "ok"` (no `detail`) turns `test_AS_063_AS_041_a_successful_tool_call_sends_a_real_bounded_summary_and_detail` red immediately. The card now expands on a real success result (a search returning docs, a doc read returning a word count) and shows a genuine per-tool detail, not an inert `search_docs  ok` row.
AS-041: PASS — the new route test asserts every emitted `tool_start`/`tool_end` line is still exactly the documented shape (`toEqual`, not `toMatchObject`), including the new `args` field; `npx vitest run tests/integration/f007-docs-agent-route.test.ts` green (23 tests, including the new AS-063/AS-041 suite).
AS-105: PASS (unchanged, re-verified) — `test_AS_105_thrown_tool_error_message_never_reaches_the_client` and `test_AS_105_upstream_failures_never_leak_raw_error_text_or_secrets` still green; the new success-path `detail` never reads raw `resultContent`, only specific known fields off the parsed `ToolResult` envelope (see `lib/ai/tool-result-display.ts`'s `describeToolResult`), so it cannot become a new leak surface.

## Files changed
lib/ai/tool-result-display.ts (new)
tests/helpers/f033-tool-result-fixtures.ts (new)
app/api/ai/docs/route.ts
lib/ai/use-doc-assistant.ts
components/ai/tool-call-card.tsx
tests/integration/f007-docs-agent-route.test.ts
tests/unit/f011-tool-call-card.test.tsx

## Commands run
`npx vitest run lib/ai tests/integration/f007-docs-agent-route.test.ts tests/unit/f011-tool-call-card.test.tsx` (0, 89 tests passed)
`npx vitest run tests/unit/f009-assistant-sidebar.test.tsx tests/unit/f010-assistant-thread.test.tsx tests/unit/f012-assistant-composer.test.tsx tests/unit/f013-assistant-empty-state.test.tsx tests/unit/f035-breadcrumb-ownership.test.tsx` (0, 46 tests passed)
`npx tsc --noEmit` (2, but only the 4 pre-existing, documented errors in `app/layout.tsx`, `components/ui/status-badge.tsx`, and `tests/unit/docs-markdown-editor-export-import.test.tsx` — none in any file this feature touched)
`npx eslint .` (0 errors; 26 pre-existing warnings in unrelated files, none new; `lib/ai/tool-result-display.ts` alone lints with 0 warnings)
Mutation check: reverted the success `tool_end` call site in `app/api/ai/docs/route.ts` to `send({ t: "tool_end", id: toolUse.id, summary: "ok" })` (no `detail`), reran `npx vitest run tests/integration/f007-docs-agent-route.test.ts tests/unit/f011-tool-call-card.test.tsx` → 1 failed (the new AS-063/AS-041 route test, exactly as expected; the card test file itself stayed green because its fixtures come from `lib/ai/tool-result-display.ts` directly, not from a live route call — see Decisions), then restored the file from a pre-mutation copy and reran the same command → 89/89 passed again.

## Decisions made
- Extracted the tool-name sanitiser (F032) plus the new summary/detail/args logic into a new pure module, `lib/ai/tool-result-display.ts`, instead of keeping everything inline in `route.ts`. Reason: Next.js App Router route files (`route.ts`) are only supposed to export HTTP method handlers and a small allowlist of config values; adding arbitrary extra named exports for test-importability risks a route-typing build error and has no precedent anywhere else in this codebase (`grep`'d every `app/api/**/route.ts` — none export anything beyond `runtime`/`POST`/etc.). Moving the pure functions to `lib/ai/` keeps `route.ts` a thin transport layer and lets both `route.ts` and the test fixture module import the exact same functions.
- `describeToolResult(content)` only reads specific known fields off the parsed `ToolResult` envelope (`results[].title`, `templates[].name`, `wordCount`, `title`) — never `content` itself and never any other field. This preserves F026/AS-105's rule ("the server computes a safe string; it never forwards raw model output") for the success path exactly as it already held for the error paths.
- `sanitizeToolArgsForDisplay(input)` `JSON.stringify`s the tool's raw (model-controlled) input, then applies the same length-bound-plus-control-character-strip treatment as `sanitizeDisplayText`, rather than reusing `sanitizeToolNameForDisplay`'s strict `[a-zA-Z0-9_-]` allowlist verbatim. AUTONOMOUS_DECISION: the spec says "bound length and charset exactly as F032 did for the tool name" — I read this as "apply the same *category* of defence (bounded length, stripped dangerous characters, server-computed, never raw)" rather than literally stripping arguments down to `[a-zA-Z0-9_-]`, because arguments are free-form data (e.g. `{"query":"budget report"}`) and an alnum-only allowlist would mangle spaces/punctuation into something unreadable while providing no additional safety over control-character stripping (the value is rendered as React text, so HTML/script injection is not a risk either way; the risk F032 cared about was a single-line NDJSON envelope and a mono-font identifier row, which control-character stripping already protects). Returns `""` (omitted from the wire entirely) for empty/no-arg tool calls rather than sending `"{}"`.
- Card's `hasContent` (renamed from `hasDetail`) now expands whenever `detail` OR `args` is present, not `detail` alone — otherwise a tool call with meaningful arguments but no interesting result detail would still render inert.
- The shared fixture module (`tests/helpers/f033-tool-result-fixtures.ts`) builds its fixtures by calling `describeToolResult`/`sanitizeToolArgsForDisplay` against real `ToolResult` envelopes built with `ok()`/`empty()`/`err()` from `lib/ai/tools/types.ts` (the exact envelope every real tool's `run()` returns), rather than hand-typing summary/detail strings. Both `tests/integration/f007-docs-agent-route.test.ts` and `tests/unit/f011-tool-call-card.test.tsx` import from it. This is the actual fix for B1's root cause, not just a patch to make one test pass — if the summary/detail format changes in the future, both suites move together automatically.
- Kept the literal `summary: "tool error"` marker (the card's only failure-detection signal, see `tool-call-card.tsx`'s header comment) coming exclusively from the thrown-exception and tool-not-found paths, unchanged — `describeToolResult`'s own `status: "error"` branch still falls back to `message ?? "tool error"`, matching the pre-F033 behaviour for that path exactly, so no new ambiguity was introduced into `isFailed()`'s detection logic.

## Out-of-scope work needed
None identified beyond this feature's stated scope. The `propose_doc_edit`/`create_doc` tools referenced in `route.ts`'s `PROPOSAL_TOOL_NAMES` are still not registered (per F014/F017, explicitly out of scope here) — `describeToolResult` has no special-case for a `doc_edit`/`doc_create` proposal payload shape and will fall through to the generic `"ok"` summary/no-detail if one of those tools' `run()` output ever reached it directly (it currently cannot, since `asProposal` intercepts and short-circuits the turn before any `tool_end` for those tool names would matter to a user reading the card). Whoever implements F014/F017 should check whether `describeToolResult` needs a case for that shape too, though the proposal event itself (not the tool card) is likely how that data actually surfaces to the user.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: interpreted "bound length and charset exactly as F032 did for the tool name" for the new argument-summary sanitiser as "apply the same defensive posture" (bounded length + server-computed + dangerous-character stripping) rather than literally reusing F032's `[a-zA-Z0-9_-]`-only allowlist, since that allowlist would destroy the readability of free-form argument text (spaces, punctuation) for no additional safety given arguments are rendered as plain React text, never HTML/markdown. See Decisions made for full reasoning.

## Notes for the next worker
- `lib/ai/tool-result-display.ts` is the single place that knows how to describe a tool's success result. If a new tool is added (e.g. F014/F017's write tools), add a case to `describeToolResult` for its `data` shape, or it will silently fall back to the bare `"ok"` summary with no detail — not a regression of B1 (still bounded/safe), but a missed opportunity for a useful card.
- No MCP tools were used for this feature — it is pure application-layer/UI work with no live external service state to introspect (Supabase schema, auth, etc. are untouched).
- The mutation-verification copy of `route.ts` was made to the session scratchpad directory and cleaned up implicitly (not committed); the git working tree was clean before/after the mutation check per `git status --short` (only the intended 7 files staged/committed).
