# Handoff: F034 — Per-turn ownership in the streaming hook

## Status
COMPLETE

## Assertions covered
AS-062: PASS — rewritten to gate the second chunk behind a promise, assert an intermediate state (`text === "Hello"` while `isStreaming` is true), then release and assert the final concatenation. Verified by mutation: skipping `applyEvent` for `"text"` events inside the read loop (simulating buffer-and-flush-at-done) turns this test red (`toHaveLength(1)` never satisfied — waitFor times out).
AS-067: PASS — two tests. (1) asserts `signal.aborted === true` is not enough on its own to prove behaviour, so it also awaits a further scheduled chunk after `stop()` and asserts the text did **not** grow (`MORE-AFTER-STOP` never present). (2) directly captures the `AbortSignal` passed to `fetch` and asserts `capturedSignal.aborted === true` after `stop()`. Verified by mutation: deleting `abortControllerRef.current?.abort()` from `stop()` (leaving only the cosmetic `setIsStreaming(false)`) turns both red.
AS-047: PASS — new test sends a first turn, waits for the reply, sends a second turn, and asserts the second request body's `messages` field equals `[{role:"user",content:"first message"},{role:"assistant",content:"first reply"}]`. Verified by mutation: removing the `messages` field from the outgoing fetch body turns this red (`parsedBody.messages` is `undefined`).
AS-041: PASS — new test sends `tool_start` → `tool_end` → a stray `tool_start` for the same id, and asserts `status` stays `"done"` (never regresses to `"running"`). Verified by mutation: removing the `if (prev[idx].status === "done") return prev;` guard turns this red (`status` becomes `"running"`).

## Files changed
lib/ai/use-doc-assistant.ts
lib/ai/__tests__/use-doc-assistant.test.tsx

## Commands run
`npx tsc --noEmit` (0 exit; output shows only the 4 documented pre-existing errors in app/layout.tsx, components/ui/status-badge.tsx, tests/unit/docs-markdown-editor-export-import.test.tsx — none in files this feature touched)
`npx eslint lib/ai/use-doc-assistant.ts lib/ai/__tests__/use-doc-assistant.test.tsx` (0, no output — clean)
`npx vitest run lib/ai tests/integration/f007-docs-agent-route.test.ts tests/unit/f009-assistant-sidebar.test.tsx tests/unit/f010-assistant-thread.test.tsx tests/unit/f011-tool-call-card.test.tsx tests/unit/f012-assistant-composer.test.tsx tests/unit/f013-assistant-empty-state.test.tsx tests/unit/f035-breadcrumb-ownership.test.tsx` (0; 13 files, 147/147 tests passed)
Did NOT run full `npm test` per the standing rule in state.md.

Mutation verification (all done by hand-editing the source, re-running the targeted test, confirming red, then restoring from a saved backup and confirming the diff was clean again):
1. `applyEvent` — skipped applying `"text"` events inside the read loop (buffer-and-flush-at-done simulation) → AS-062 test went red. Restored.
2. `stop()` — removed `abortControllerRef.current?.abort()` → both AS-067 tests went red. Restored.
3. `tool_start` regression guard — removed the `status === "done"` check → AS-041 test went red. Restored.
4. Unmount cleanup — removed `abortControllerRef.current?.abort()` from the `useEffect` cleanup → the new unmount test went red (`capturedSignal.aborted` stayed `false`). Restored.
5. Non-2xx message surfacing — removed the `response.json()` read and hardcoded the generic message → both non-2xx tests went red (`message` mismatch). Restored.
6. History payload — removed `...(historyTurns.length > 0 ? { messages: historyTurns } : {})` from the request body → AS-047 test went red (`parsedBody.messages` undefined). Restored.

Also confirmed via `git diff` / `diff` against a saved pre-edit copy of the file that no mutation leaked into the final committed version.

## Decisions made
- `applyEvent` now takes the turn's `AbortController` as a second argument and bails via `if (controller.signal.aborted) return;` before any `setState` call — this is the single choke point that makes every one of the five defects impossible to reintroduce independently (a future edit that adds a new event type still gets the guard for free).
- Added a `messagesRef` mirror of `messages` state (kept in sync via a `useEffect`) so `send()` can read "the conversation right now" synchronously when building the history payload, without making `send` depend on `messages` (which would have recreated the callback — and any memoised consumer handlers — on every delta).
- Replaced the `err.name === "AbortError"` check with `controller.signal.aborted` per the spec's explicit guidance (undici rejects as `TypeError: fetch failed` with the real abort in `.cause`; jsdom's `DOMException` is not `instanceof Error`).
- History is built from the conversation *as it stood before* the current turn's user message was appended (i.e., prior turns only), trimmed to `MAX_HISTORY_TURNS` (20, mirrored as a client-side constant from `app/api/ai/docs/route.ts`) and with empty-text messages filtered out, matching `historyTurnSchema`'s `.min(1)` content constraint. The route remains the sole source of truth/enforcement for the cap; the client-side trim only avoids sending a request the route would reject outright.
- Non-2xx handling: read `response.json()` for `{error: string}` first, only falling back to a generic message if the body isn't valid JSON or lacks a non-empty `error` string; the body is defensively cancelled in a `finally` in case `.json()` didn't fully consume it (some environments still hand back a readable body after a failed parse).
- `tool_start` after `tool_end` for the same id is now a no-op (returns `prev` unchanged) rather than overwriting status back to `"running"` — chosen over silently dropping the whole event, so any name/args update in a legitimate (if unusual) resend still lands if the call isn't finished yet; only a call already `"done"` is protected.
- Added `mountedRef` alongside the existing `abortControllerRef`/`openAssistantIdRef` pattern, guarding the `finally` block's `setIsStreaming(false)` call so it can't run after unmount even in the (unlikely, but not impossible) case a read resolves in the same tick the unmount effect's abort fires.
- Rewrote the unmount test to assert on the fetch's own `AbortSignal.aborted` (via a `fetchMock.mockImplementationOnce` that captures `init.signal`) rather than on `messages` after unmount — React discards post-unmount `setState` calls regardless of whether this hook cleans up anything, so a `messages`-based assertion would have been a second tautological test exactly like the ones B2 called out. Verified this claim by mutation (see #4 above): the original messages-based approach (in an earlier draft of this test, not committed) passed even with cleanup deleted; the signal-based version does not.

## Out-of-scope work needed
- The route's `messages` field only round-trips plain text (no tool_use/tool_result blocks) per its own header comment — full conversational memory of tool calls awaits F018/F019 persistence. Not in scope for this hook; noted here so a future worker doesn't assume F034 fixed that gap too.
- `usage` accumulation resets on `reset()` but not on unmount+remount of a *different* conversation (e.g. switching docs) — no spec coverage requested this; flagging as a possible product question, not a defect.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to filter out empty-text messages when building the history payload (`m.text.trim().length > 0`) because `historyTurnSchema.content` requires `.min(1)` server-side — an assistant turn that streamed no text (e.g. tool-only turn) would otherwise produce a `content: ""` entry the route's Zod schema rejects with a 400, breaking every subsequent turn in that conversation. Not explicitly asked for in the spec but required for AS-047 to hold up under the tool-call-first-turn scenario. This didn't require a new test since no assertion covers tool-only turns, but the guard is defensive and low-risk.
AUTONOMOUS_DECISION: The `MAX_HISTORY_TURNS` constant is duplicated (route + hook) rather than imported, because the route is a server-only Next.js route module and the hook is `"use client"` — sharing a literal constant across that boundary via import risks pulling server-only code into the client bundle. Mirrored the value with a comment pointing at the source of truth instead.

## Notes for the next worker
- The mutation-verification workflow I used: `cp lib/ai/use-doc-assistant.ts /tmp/use-doc-assistant.ts.bak` before any edits, then for each mutation a small `python3 -c` heredoc did an exact `str.replace` on the known-good source, ran the targeted test with `-t "<pattern>"`, confirmed red, then `cp /tmp/use-doc-assistant.ts.bak lib/ai/use-doc-assistant.ts` to restore and `diff` to confirm no residue before moving to the next mutation.
- Watch out for jsdom `ReadableStream` mocks with a synchronous, unconditional `pull(controller) { controller.enqueue(...) }` (no gate, no `return new Promise(() => {})`, no closed flag) — the underlying stream implementation calls `pull` again immediately whenever the queue drains below `highWaterMark`, which with no async boundary becomes a synchronous infinite loop and OOMs the vitest worker (hit this twice while writing `test_AS_067_stop_sets_the_real_abort_signal_aborted` and `test_double_submit_aborts_the_first_turns_stream` — fixed with an `enqueued` boolean guard that returns a never-resolving promise on subsequent `pull` calls).
- Real fetch/undici automatically tears down (rejects) a pending `response.body` read when the request's `AbortController` fires; a hand-rolled mock `ReadableStream` does **not** do this on its own. The unmount test wires this manually via `capturedSignal.addEventListener("abort", () => streamController.error(...))` to mirror real behaviour — reuse this pattern for any future test needing to simulate "abort mid-read".
