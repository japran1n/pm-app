# Handoff: F007 — Route handler with streaming + tool loop

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `auth.getUser()` is checked before `buildDocsAgentRequest`/the
Anthropic client are ever touched; a `null` user returns 401 immediately.
Verified by `test_AS_007_unauthenticated_request_gets_401_before_any_model_call`
(asserts both the 401 status AND that `buildDocsAgentRequest`/`stream` were
never called).
AS-040: PASS — event shapes match `tech-decisions.md`'s envelope exactly
(`text`/`tool_start`/`tool_end`/`proposal`/`usage`/`error`/`done`).
Verified by `test_AS_040_ndjson_envelope_matches_the_contract_shape`.
AS-041: PASS — every emitted line is `JSON.stringify(event) + "\n"`, one
object per line. Verified by
`test_AS_041_every_line_is_exactly_one_valid_json_object`, which parses
every non-empty line independently.
AS-042: PASS — `tool_start` is sent immediately before `tool.run()`, and
`tool_end` is sent from both the success path and the `catch` block, same
`id`. Verified by
`test_AS_042_tool_end_always_pairs_with_tool_start_even_on_throw` (also
proves the loop survives the throw and makes a second model call rather
than crashing the request).
AS-043: PASS — a tool result matching the `DocEditProposal`/`DocCreateProposal`
shape ends the turn immediately (`turnEnded = true`, loop breaks) without a
further model call. Verified by
`test_AS_043_a_proposal_result_ends_the_turn_immediately` (asserts
`streamMock` was called exactly once).
AS-044: PASS — a single `AbortController` is created per request, the
incoming `request.signal`'s `"abort"` listener calls `abortController.abort()`,
and that controller's `signal` is passed as `{ signal }` to every
`client.beta.messages.stream(...)` call. Verified by
`test_AS_044_client_abort_propagates_to_the_sdk_call`.
AS-045: PASS — `hasApiKey() === false` short-circuits before
`buildDocsAgentRequest`/`getAnthropicClient` are called, emits exactly
`error(no_api_key)` then `done`, and the `Response` status is 200. Verified
by `test_AS_045_no_api_key_opens_stream_with_error_then_done_at_http_200`.
AS-046: PASS — `RateLimitError` thrown from `finalMessage()` is caught and
mapped to `error(rate_limited)` then `done`. Verified by
`test_AS_046_anthropic_429_maps_to_rate_limited_error_code`.
AS-048: PASS — before running a tool batch, `toolCallCount + batch.length >
8` short-circuits to `error(tool_limit)` + `done` and no tool in that batch
is actually invoked. Verified by
`test_AS_048_more_than_8_tool_calls_in_one_turn_stops_with_tool_limit`
(asserts the mock tool's `run` was never called).
AS-105: PASS — `handleUpstreamError` never forwards `error.message` from a
raw `APIError`/unexpected error; it always emits one of two fixed, generic
strings, and only `error.status` (a number) is logged, never the message
body. Verified by
`test_AS_105_upstream_failures_never_leak_raw_error_text_or_secrets`
(constructs an `APIError` whose message contains a fake password and
asserts neither the password nor the word "postgres" appear in the emitted
event).

## Files changed
app/api/ai/docs/route.ts
tests/integration/f007-docs-agent-route.test.ts

## Commands run
`npx tsc --noEmit` (0) — 0 new errors; same 3 pre-existing baseline errors
F001/F006 document (`app/layout.tsx`, `components/ui/status-badge.tsx`,
`tests/unit/docs-markdown-editor-export-import.test.tsx`)
`npx eslint .` (0) — 0 errors, 26 pre-existing warnings in unrelated test
files (identical set F006's handoff documents)
`npx vitest run lib/` (0) — 68/68 passing, unchanged (this feature adds no
files under `lib/`)
`npx vitest run tests/integration/f007-docs-agent-route.test.ts` (0) —
10/10 new contract tests passing. NOT part of `npm test`'s live-Supabase
suite (per the mission's documented reason not to run `npm test`); this
file mocks `@/lib/supabase/server`, `@/lib/ai/client`, and
`@/lib/ai/docs-agent` entirely, so no real network/Supabase/Anthropic call
is ever made.
`git branch --show-current` — confirmed `feat/ai-docs-sidebar` before
committing

## Decisions made
- Implemented the tool loop **manually** (`client.beta.messages.stream()` +
  a hand-rolled `while` loop) instead of `client.beta.messages.toolRunner()`.
  Read `BetaToolRunner`'s source (`node_modules/@anthropic-ai/sdk/src/lib/
  tools/BetaToolRunner.ts`) first: its automatic tool-execution loop runs
  tools *inside* its own iteration with no hook for "stop the whole turn
  right after this one tool result, before any further model call" (needed
  for AS-043) or for "the caller decides mid-batch whether it's already over
  the 8-call cap" (AS-048) — both would require either monkey-patching tool
  `run` functions to throw a sentinel and catching it above the runner's own
  `try/finally` (fragile, and the runner still makes progress internally
  before the throw propagates), or `max_iterations`/`setMessagesParams`
  tricks that don't map onto "stop after this specific tool result." Driving
  `client.beta.messages.stream()` directly and calling
  `tool.parse()`/`tool.run()` myself (the same two-step `runRunnableTool`
  the SDK's own runner uses internally, at `lib/tools/BetaRunnableTool.ts`)
  gives full, explicit control over event ordering, the cap check, and the
  proposal short-circuit, with no behavior difference for the model (same
  request/response shape either way).
- `workspaceId` passed to `buildDocsAgentRequest` is the empty string `""`.
  The request body's literal shape per this feature's spec is
  `{ threadId?, message, currentDocId? }` — no `workspaceId` field. F006's
  `buildDocsAgentRequest` accepts `workspaceId` but (per its own handoff
  and an inline `void workspaceId` in `lib/ai/docs-agent.ts`) never keys any
  query on it — every tool call is scoped by the caller's own RLS session
  instead. Passing `""` is therefore a true no-op, not a security gap; noted
  here rather than silently inventing a new request field or a lookup this
  feature was told is out of scope.
- Proposal detection (`asProposal`) is written generically against the
  `ToolResult<T>` envelope shape (`status: "ok"` + `data.kind ===
  "doc_edit" | "doc_create"`) even though no registered tool (F003-F005)
  currently returns one — F014/F017 haven't landed yet. This makes AS-043
  real, tested behavior today (via a test double tool) rather than dead
  code waiting on a future feature, and requires no route change when
  `propose_doc_edit`/`create_doc` are added to `DOCS_AGENT_TOOLS`.
- `tool_end`'s `summary` is derived from the tool's own `ToolResult`
  envelope (`"ok"`, or the tool's own already-safe `message` for
  `empty`/`error` per `lib/ai/tools/types.ts`'s AS-105 contract on that
  type) — the route never constructs a new human-facing string from
  whatever a tool returns, since the tools already guarantee that string is
  safe to render.
- Session identity uses the cookie-based `lib/supabase/server.ts`
  `createClient()` (the same one `lib/actions/docs.ts`'s `requireUser()`
  uses), NOT the bearer-token pattern in `app/api/extension/*`'s routes —
  this endpoint is called from the docs sidebar inside the authenticated
  web app (same-origin, cookie session), unlike the browser-extension
  routes which are cross-origin and have no cookie access.

## Out-of-scope work needed
- F014/F017 (write tools): once `propose_doc_edit`/`create_doc` are
  registered in `DOCS_AGENT_TOOLS` (`lib/ai/docs-agent.ts`), this route
  needs no changes — `asProposal()` and the turn-ending logic already
  handle any tool whose `ToolResult.data` carries `kind: "doc_edit" |
  "doc_create"`. Confirm with a live (non-mocked) tool once those land.
- F018/F019 (persistence): `threadId` is currently read and validated
  (optional string) but completely unused — no message history is loaded
  or saved. The route builds a single-turn `messages` array from just the
  incoming `message`. When persistence lands, the loader/saver plugs in
  around the `messages` array construction and the final `messages` value
  after the loop.
- F020 (rate limiting): none implemented in this route, per spec.
- A live/integration check of `usage.cache_read_input_tokens > 0` on a real
  second turn (AS-047, owned by F006 but explicitly deferred to "F007 or a
  live-integration check" in F006's handoff) is still not closed —
  `ANTHROPIC_API_KEY` remains absent from `.env` in this environment, so no
  worker can make a real Anthropic call. The `usage` event's `cached` field
  is wired end-to-end (`finalMessage.usage.cache_read_input_tokens ??
  0` -> the event), and this is unit-tested with a mocked non-zero value in
  `test_AS_040_ndjson_envelope_matches_the_contract_shape`, but a true
  `> 0` value from a real cache hit needs a live key.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `missions/20260909-ai-docs/clarifications/`
directory exists in this worktree at all (checked; same situation F006's
handoff records for itself). Treated `features/F007.md`, `tech-decisions.md`,
and F006's handoff as the fully authoritative clarified spec, since they
were internally consistent and left no genuine ambiguity beyond the
`workspaceId` point above (which itself resolves unambiguously from F006's
own documented no-op contract for that parameter).

AUTONOMOUS_DECISION: For a malformed/invalid JSON request body (fails Zod
validation), the route returns a plain `400 { error: "..." }` JSON response
*before* opening the NDJSON stream, rather than opening the stream and
emitting an `error` event. Rationale: this is a client bug in the
transport-level contract itself (not a case the spec's error table
enumerates), directly analogous to how `app/api/extension/tasks/route.ts`
handles a schema validation failure — a normal HTTP error response, not a
streamed one. No assertion covers this path either way.

## Notes for the next worker
Exact event sequence emitted by this route, byte-for-byte, for F008 (or any
future NDJSON consumer) to rely on:

- **Normal text-only turn**: zero or more `{"t":"text","v":"..."}` (one per
  streamed delta) → `{"t":"usage","in":N,"out":N,"cached":N}` →
  `{"t":"done"}`.
- **Turn with a non-write tool call** (e.g. `search_docs`): `{"t":"text",...}`
  deltas (if any, before the tool_use) → `{"t":"tool_start","id":"...",
  "name":"..."}` → `{"t":"tool_end","id":"...","summary":"...","detail"?:"..."}`
  (repeated per tool call in that batch, `id` always matches its `tool_start`)
  → the loop makes another model call with the tool results appended →
  more `text`/`tool_start`/`tool_end` as needed → final
  `{"t":"usage",...}` → `{"t":"done"}`.
- **Turn ending in a proposal**: ... → `{"t":"tool_start",...}` →
  `{"t":"tool_end",...}` (the tool itself always completes normally; a
  proposal is a *successful* `ToolResult`, not an error) →
  `{"t":"proposal","id":"<same id as the tool_start/tool_end>","kind":
  "doc_edit"|"doc_create","payload":{...}}` → **no further text/tool
  events** → `{"t":"usage",...}` → `{"t":"done"}`. The turn ends the
  instant a proposal is produced, even if the model requested other tools
  in the same batch — any tool calls in that batch *after* the proposing
  one in array order still run (so every `tool_start` in the batch still
  gets its `tool_end`, preserving AS-042), but no further model call is
  made afterward.
- **`no_api_key`**: exactly `{"t":"error","code":"no_api_key","message":
  "..."}` → `{"t":"done"}`. Nothing else, ever. HTTP status is always 200.
- **`rate_limited`** / **`upstream`**: whatever `text`/`tool_start`/
  `tool_end` events happened before the failing model call, then exactly
  one `{"t":"error","code":"rate_limited"|"upstream","message":"..."}` →
  `{"t":"done"}`. No `usage` event is emitted on this path (there is no
  final message to read usage from).
- **`tool_limit`**: the triggering batch's tools are NOT executed at all
  (checked before any `tool_start` in that batch is sent) — exactly
  `{"t":"error","code":"tool_limit","message":"..."}` → `{"t":"done"}`,
  possibly preceded by `text`/`tool_start`/`tool_end` events from earlier,
  under-the-cap batches in the same turn.
- **Client abort**: the stream simply closes with whatever was already
  enqueued; no `error`/`done` event is guaranteed to follow (the
  `AbortController` propagated into the SDK call tears down the upstream
  request, and the route's `catch` block detects `abortController.signal
  .aborted` / an abort-shaped error and returns without sending more
  events — there's no reader left to receive them anyway).

Gotchas for whoever touches this file next:
- `agentRequest.tools` from `buildDocsAgentRequest` is a `readonly` tuple
  (`as const` in `lib/ai/docs-agent.ts`) — spread it (`[...agentRequest.tools]`)
  before passing to `client.beta.messages.stream(...)`, which wants a
  mutable array.
- `tool.run` / `tool.parse` on a `BetaRunnableTool` are typed per-tool
  (`z.infer<Schema>`), but this route iterates over a heterogeneous array of
  tools generically — the cast to `never` on the input at the call site is
  intentional and matches how the SDK's own `BetaToolRunner` handles the
  same heterogeneity internally (see `runRunnableTool` in
  `node_modules/@anthropic-ai/sdk/src/lib/tools/BetaRunnableTool.ts`, which
  isn't exported publicly, hence not reused directly).
- No MCP tools were used for this feature — pure application code, no live
  external-service schema/policy to inspect. `mcp-registry.md` was read;
  nothing in it applied here beyond what F001-F006 already established.
