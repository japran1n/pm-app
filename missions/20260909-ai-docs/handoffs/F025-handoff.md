# Handoff: F025 — Fix the abort path

## Status
COMPLETE

## Assertions covered
AS-044: PASS — new test `test_AS_044_test_AS_042_reader_cancel_mid_stream_tears_down_cleanly` reads one chunk, cancels the reader mid-stream, resolves the still-in-flight upstream call afterward, and asserts (a) no `unhandledRejection` fires, (b) the signal handed to the Anthropic SDK is genuinely `aborted`, (c) nothing is enqueued after cancel (a post-cancel read completes immediately). Also covered by the existing `test_AS_044_client_abort_propagates_to_the_sdk_call`.
AS-042: PASS — every `tool_start`/`tool_end` pairing path is unchanged; existing pairing tests (`test_AS_042_*` in the suite, e.g. tool error path) still pass, and the new cancel test additionally confirms no stray/duplicate events are enqueued once the stream is torn down mid-turn.

## Files changed
app/api/ai/docs/route.ts
tests/integration/f007-docs-agent-route.test.ts

## Commands run
`npx tsc --noEmit` (0; 4 pre-existing errors unrelated to this feature: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, 2x tests/unit/docs-markdown-editor-export-import.test.tsx — none in app/api/ai/docs/route.ts or the test file touched here)
`npx eslint .` (0; 26 pre-existing warnings, none new, none in files touched here)
`npx vitest run lib/` (0; 70/70 passed)
`npx vitest run tests/integration/f007-docs-agent-route.test.ts` (0; 11/11 passed — 10 pre-existing + 1 new)
`npx vitest run tests/integration/f007-docs-agent-route.test.ts` with `cancel()` temporarily reverted to the old no-op `abortControllerCancelNoop()` and `send`/`finish` reverted to their un-guarded originals (proof-of-failure run; see below) — 1 failed (`test_AS_044_test_AS_042_reader_cancel_mid_stream_tears_down_cleanly`), 10 passed

## Proof-of-failure evidence
Temporarily restored the exact pre-fix shape (`cancel() { abortControllerCancelNoop(); }`, unguarded `send`/`finish`, module-scope no-op restored) and reran the new test in isolation:

```
 FAIL  tests/integration/f007-docs-agent-route.test.ts > test_AS_044_test_AS_042_reader_cancel_mid_stream_tears_down_cleanly > aborts the upstream SDK call, causes no unhandled rejection, and enqueues nothing after cancel
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/integration/f007-docs-agent-route.test.ts:350:40
    348|       // satisfy `instanceof AbortSignal`).
    349|       const [, options] = streamMock.mock.calls[0] as [unknown, { sign…
    350|       expect(options?.signal?.aborted).toBe(true);
       |                                        ^

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

The buggy `cancel()` never touched `abortController`, so `signal.aborted` stayed `false` after the reader was cancelled — proving the test exercises the real abort path rather than a signal-instance-only check. Reverted immediately back to the fixed version (`git diff` confirmed clean revert; all commands above were re-run afterward against the fixed code and passed).

## Decisions made
- Moved `abortController` and the `closed` flag out of `start()`'s closure and up to `POST`'s top level (still per-request — a fresh `const` per invocation of `POST`), so both `start()`'s body and the sibling `cancel()` callback on the same `ReadableStream` underlying-source object close over the *same* controller and flag. This was the minimal change satisfying the spec's "cancel() must be a closure with access to the request's abortController."
- `cancel()` now does exactly what B3 asked: `closed = true` then `abortController.abort()`. No extra event emission — nobody is listening to the body once `cancel()` fires, so there is nothing useful to `send()`.
- `send()` now also checks `abortController.signal.aborted` in addition to `closed` (belt-and-suspenders: an abort via `request.signal` and a call to `cancel()` are two different triggers reaching the same effect, but checking both makes the guard correct regardless of which fires first) and wraps `controller.enqueue` in try/catch as a last-resort guard against a same-tick race between `cancel()` firing and an in-flight `send()` call — sets `closed = true` if that ever happens so subsequent calls short-circuit on the cheap path.
- `finish()` wraps `controller.close()` in try/catch for the same reason — idempotent by the `closed` check already, but the try/catch protects against the platform closing/erroring the controller out from under us via `cancel()` between the `if (closed) return` check and the `controller.close()` call (a genuine race, not just defensive noise).
- Checked the rest of the file per the instruction to look for "the same shape elsewhere": no other module-scope helper touches per-request state. `isAbortLike` and `handleUpstreamError` are pure functions that take everything they need as arguments (error, `send`, `clientAborted`) — the correct pattern, unlike the old `abortControllerCancelNoop`. Removed that dead function entirely.
- Test uses a new `pendingAnthropicStream()` fixture (fires one text delta synchronously, then hangs on a caller-controlled promise) rather than reusing `fakeAnthropicStream`, because the existing fixture resolves `finalMessage()` synchronously within the same microtask turn, leaving no window to read a chunk and cancel before the SDK call "completes." This is the direct fix for the spec's complaint about the old test ("a fresh, never-aborted signal passes identically").
- Used `process.on("unhandledRejection", ...)` around the cancel/resolve sequence rather than relying on Vitest's own unhandled-rejection reporting, so the test fails explicitly and locally rather than depending on runner-wide behavior that might not fail the specific test.

## Out-of-scope work needed
None identified beyond B3's stated scope. The rest of the tool-call loop, error mapping, and proposal short-circuit logic were not touched and were not implicated by B3.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added the `abortController.signal.aborted` check inside `send()` (in addition to `closed`) and wrapped `enqueue`/`close` in try/catch, beyond the spec's literal three bullet points. Rationale: the spec's own bug narrative is a *race* (client aborts while upstream call is in flight) — a single boolean flag set at one call site is enough to fix the scenario as narrated, but a defensive catch keeps the fix correct under reordering the platform doesn't guarantee, without changing observable behavior for any passing test. This is the "guard `send()` so nothing enqueues after close or after the signal aborts" bullet interpreted maximally rather than minimally.

## Notes for the next worker
- The two triggers for tearing down a request — `request.signal` aborting (fetch-level abort) and the stream's own `cancel()` (reader-level cancel, called even without an explicit `AbortController` on the client, e.g. when a `<ReadableStream>` consumer just stops reading) — are distinct in the Streams spec and both had to reach the same `abortController`/`closed` state. Any future change to this file that reintroduces per-request state trapped inside `start()`'s closure alone will reopen this exact bug for the `cancel()` path specifically, since `cancel()` is a sibling property of the underlying source object, not something declared inside `start()`.
- No MCP tools were used — this feature touches only in-repo transport code with fully mocked Supabase/Anthropic seams, per `mcp-registry.md`'s guidance that pure logic/test work doesn't need MCP verification.
