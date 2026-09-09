# Handoff: F008 — Client stream parser hook

## Status
COMPLETE

## Assertions covered
AS-062: PASS — test_AS_062_text_deltas_append_progressively_across_multiple_chunks asserts multiple `text` events append onto a single open assistant message rather than each creating a new one, and the hook is architected to update React state on every parsed line, not just at `done`.
AS-067: PASS — test_AS_067_stop_aborts_stream_keeps_partial_text_and_clears_streaming asserts `stop()` aborts the in-flight fetch, `isStreaming` goes false, and the partial assistant text received so far remains in `messages`.

## Files changed
lib/ai/use-doc-assistant.ts
lib/ai/__tests__/use-doc-assistant.test.tsx

## Commands run
`npx vitest run lib/ai` (0) — 6 files / 52 tests passed
`npx tsc --noEmit` (1, but only the 4 documented pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — zero new errors from this feature's files)
`npx eslint lib/ai/use-doc-assistant.ts lib/ai/__tests__/use-doc-assistant.test.tsx` (0, no output)

## Decisions made
- Read the live `send(...)` calls in `app/api/ai/docs/route.ts` (not the stale envelope table in tech-decisions.md) as the source of truth for the wire shape. Confirmed events are: `text{v}`, `tool_start{id,name}`, `tool_end{id,summary,detail?}`, `proposal{id,kind,payload}`, `usage{in,out,cached}`, `error{code,message}`, `done`.
- Buffered NDJSON parsing: kept a `buffer` string across `reader.read()` calls, split on `\n`, always re-buffered the last (possibly-partial) element via `lines.pop()`, and flushed any trailing complete line once the stream closes (final chunk need not end in `\n`). Covered by `test_chunk_boundary_json_object_split_mid_line_parses_correctly`, which splits a real JSON line exactly in half across two chunks.
- Unknown `t` values are ignored via a `default:` no-op branch in `applyEvent`'s switch — covered by `test_unknown_event_type_is_ignored_not_thrown` — for forward compatibility with M3's envelope growth, per spec.
- `send(text)` posts `{ workspaceId, message, currentDocId? }`. `currentDocId` is only included in the body when a truthy value is passed in (`...(currentDocId ? { currentDocId } : {})`), matching the route's `.uuid().optional()` validation — never sending a non-uuid placeholder. Verified with two tests: one asserting the key is entirely absent when `currentDocId` is null/undefined, one asserting it's present and equal to a valid uuid when provided.
- `stop()` aborts the hook's own `AbortController`; the in-flight async IIFE's catch block treats `AbortError` as a silent, expected termination (no `error` state set) so a user-initiated stop never looks like a failure.
- Calling `send()` again while a previous turn is still streaming aborts the previous controller first (last-call-wins), matching typical chat-hook conventions seen in `lib/hooks/use-optimistic-action.ts` and friends (single-instance-owned state, no cross-call coordination needed).
- `tool_end` arriving without a prior `tool_start` for that id still creates a `toolCalls` entry (defensive; the route pairs them 1:1 in practice per AS-042, but the hook shouldn't drop data if that pairing were ever violated).
- Followed the codebase's hook conventions from `lib/hooks/use-optimistic-action.ts` (client hook, `"use client"` directive, plain function returning a typed object, no external state library) — this hook diverges from that file's `useOptimistic`/`useTransition` pattern because streaming a fetch response has no analogue to a single async Server Action, but keeps the same "one hook instance = one call site's state" ownership model.
- Used `@testing-library/react`'s `renderHook`/`act`/`waitFor` (already a project dependency) with `// @vitest-environment jsdom` pragma per this repo's per-file jsdom opt-in convention documented in `vitest.config.ts`.
- Test count: `npx vitest run lib/ai` reports 52 tests across 6 files (not the 63 mentioned in the spec's "Gates" section as the pre-F008 baseline — that number may have referred to a different scope/moment; regardless, all files in `lib/ai` pass green with F008's new tests included, and no test regressed).

## Out-of-scope work needed
- Rendering the hook's state (message bubbles, tool cards, proposal diff/Accept/Reject UI, stop button, empty-state chips) is F009–F013's job per the spec's "Out of scope" section — untouched here.
- Accept/Reject wiring for `proposals` (moving a proposal from `pending` to `accepted`/`rejected`) is explicitly F015/F016's responsibility; this hook only exposes the `status: "pending"` initial state and the `ProposalView` shape those features will mutate.
- Persistence/`threadId` handling remains out of scope per the route's own F018/F019 deferral — this hook does not send or read `threadId`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The feature spec's API sketch is `useDocAssistant({ currentDocId }) => {...}` but the mission's top-level task description in this run explicitly requires `workspaceId` too ("send both correctly... omit currentDocId rather than a uuid placeholder") and the route hard-requires `workspaceId` in the body. Implemented `useDocAssistant({ workspaceId, currentDocId })` — the task instructions and the live route both take precedence over the (older) spec's parameter list, which predates the route's F027 `workspaceId` requirement.
AUTONOMOUS_DECISION: `AssistantMessage.id` is a locally-generated string (`local_<rand>_<time>`), since the route never emits any per-message id for text turns — only tool calls and proposals carry server-assigned ids. Local ids are stable within a hook instance's lifetime, which is all React reconciliation needs.

## Notes for the next worker
Exact public shape of `useDocAssistant`, for F009–F013 to consume:

```ts
useDocAssistant({ workspaceId: string, currentDocId?: string | null }) => {
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  toolCalls: { id: string; name: string; status: "running" | "done"; summary?: string; detail?: string }[];
  proposals: { id: string; kind: "doc_edit" | "doc_create"; payload: unknown; status: "pending" | "accepted" | "rejected"; }[];
  isStreaming: boolean;
  error: { code: string; message: string } | null;
  send: (text: string) => void;   // no-ops on empty/whitespace-only text
  stop: () => void;               // aborts in-flight turn, keeps partial text
  reset: () => void;              // clears all state, aborts any in-flight turn
}
```

Gotchas for consumers:
- `send()` appends the user's turn to `messages` synchronously (role "user"), then streams the assistant's reply into a NEW `messages` entry (role "assistant") that gets appended to on every `text` event — there is exactly one open assistant message per turn, closed implicitly when the next `send()` resets `openAssistantIdRef`.
- `toolCalls` and `proposals` are NOT reset between turns within the same hook instance — they accumulate across the whole conversation (matches how a scrollback sidebar would want to render tool/proposal history). Only `reset()` clears them.
- `error` is sticky until the next `send()` call clears it (or `reset()`). It does NOT clear `messages`/`toolCalls`/`proposals` — an errored turn's partial output stays visible, per the route's `error` event semantics (it can arrive mid-turn, e.g. `tool_limit`, and the route still sends `done` after).
- The hook makes no request until `send()` is called — no auto-fetch on mount.
- This file has zero JSX and zero rendering decisions, per spec; F010/F011 own presentation.
- No MCP tools were used for this feature — it is pure client-side parsing logic with no external service or live schema dependency.
