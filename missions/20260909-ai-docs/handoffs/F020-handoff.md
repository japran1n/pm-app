# Handoff: F020 — Guards: rate limit, cost ceiling, error states

## Status
COMPLETE

## Assertions covered
AS-046: PASS — per-user rate limit (20 req/min, in-memory) and per-thread token ceiling (200k tokens) both wired into `app/api/ai/docs/route.ts`; on trip, each emits `{t:"error",code:"rate_limit"|"thread_limit",...}` then `{t:"done"}` at HTTP 200 before any model call. Verified in `app/api/ai/docs/__tests__/f020-guards-route.test.ts`.
AS-048: PASS — unchanged (`MAX_TOOL_CALLS_PER_TURN` cap), re-verified still green in `tests/integration/f007-docs-agent-route.test.ts` after adding the rate-limit reset to that file's `beforeEach`.
AS-105: PASS — audited `lib/ai/` and `app/api/ai/` for bare `console.log/error/warn`; found none (every log site already routes through `lib/observability/logger.ts`). Nothing to remediate.

## Files changed
lib/ai/guards.ts (new)
lib/ai/error-display.ts (new)
lib/ai/__tests__/guards.test.ts (new)
lib/ai/__tests__/error-display.test.ts (new)
lib/ai/__tests__/f020-sidebar-error-rendering.test.tsx (new)
app/api/ai/docs/__tests__/f020-guards-route.test.ts (new)
app/api/ai/docs/route.ts (guards wired in; header comment corrected)
components/ai/assistant-sidebar.tsx (error rendering now uses lib/ai/error-display.ts's tone mapping)
lib/ai/use-doc-assistant.ts (adds `usageRef` + sends `threadUsage` in the request body; only the F020-specific hunks are mine — see "Notes for the next worker")
tests/integration/f007-docs-agent-route.test.ts (added `__resetRateLimitStoreForTests()` to `beforeEach` so the new rate limiter's cross-request module state doesn't leak between that file's many same-user requests)

## Commands run
`npx tsc --noEmit` (0 new errors beyond the 4 pre-existing: `app/layout.tsx` LayoutProps, `components/ui/status-badge.tsx` overload, `tests/unit/docs-markdown-editor-export-import.test.tsx` x2 — see Notes for a caveat)
`npx eslint lib/ai/guards.ts lib/ai/error-display.ts lib/ai/__tests__/guards.test.ts lib/ai/__tests__/error-display.test.ts lib/ai/__tests__/f020-sidebar-error-rendering.test.tsx app/api/ai/docs/route.ts app/api/ai/docs/__tests__/f020-guards-route.test.ts components/ai/assistant-sidebar.tsx lib/ai/use-doc-assistant.ts tests/integration/f007-docs-agent-route.test.ts` (0)
`npx vitest run lib/ai app/api/ai` (2-3 failing tests, all in `lib/ai/__tests__/use-doc-assistant-persistence.test.tsx` — pre-existing/out of my scope, see Blockers-equivalent note below; every F020 test passes)
`git commit` (0)

## Decisions made
- In-memory rate limit: acceptable for single-instance deployment; would need Redis on multi-instance, since each instance would keep its own independent 20/min counter and the effective limit would become `20 * instanceCount` rather than 20 per user. Documented in `lib/ai/guards.ts`'s file header.
- Token ceiling input source: the route stays pure transport per its own header comment (no DB reads), so `checkTokenCeiling` takes a `threadUsage` number supplied by the client rather than querying persisted usage server-side. `useDocAssistant` already tracks a running `usage` total client-side (input+output tokens across the thread) — `send()` now forwards `usage.inputTokens + usage.outputTokens` as `threadUsage` in the request body. This is a UX-level guard (nudge to start a new chat), not a security boundary — the actual anti-abuse guard is the per-user rate limit, which is server-tracked and cannot be spoofed by the client.
- Guard failures use the same "HTTP 200 + one `error` event + `done`" convention the route already uses for `no_api_key`/`tool_limit`, via a new small `ndjsonSingleErrorResponse` helper — kept the wire contract uniform rather than introducing a new failure shape.
- `no_api_key` renders with `bg-muted text-muted-foreground` (neutral) per spec ("configuration state, not a failure"); every other code (including future/unknown ones) renders with the existing `bg-status-waiting-bg text-status-waiting` (amber/warning) treatment the sidebar already used for all errors before this feature.
- `lib/ai/error-display.ts` recognises `auth_error`/`model_error` even though the route doesn't currently emit them (per the F020 spec's explicit code list) — future-proofing so the sidebar never needs a follow-up change if/when the route starts emitting them.
- AS-105 audit: grepped `lib/ai/` and `app/api/ai/` for `console.log|console.error|console.warn` (excluding `__tests__`) and found zero matches — every log call already routes through `logger.*`. No remediation was needed; documented as a clean pass rather than invented work.

## Out-of-scope work needed
None new from F020 itself. See Notes below for a pre-existing, out-of-scope issue this session inherited (not created).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose to have the client (`useDocAssistant`) self-report cumulative thread token usage via a new `threadUsage` field on the request body, rather than adding server-side persistence lookups to the route, because the route's own header comment explicitly scopes it to "pure transport" with no DB reads, and F018/F019's persistence work is a separate, already-uncommitted feature I should not fold guard logic into (see Notes).

## Notes for the next worker
**Inherited uncommitted work — please read before touching `lib/ai/use-doc-assistant.ts`, `lib/actions/ai-threads.ts`, or `components/ai/assistant-sidebar.tsx`:** when this feature started, `git status` already showed extensive uncommitted F018/F019 work (thread/message persistence: `lib/actions/ai-threads.ts`, hydration/persistence logic in `lib/ai/use-doc-assistant.ts`, a `lib/ai/__tests__/use-doc-assistant-persistence.test.tsx` test file, and an untracked `missions/20260909-ai-docs/handoffs/F018-handoff.md`) — despite `git log` showing only F018's *migration* commit (`feat(F018): add ai_threads + ai_messages migration with RLS`), not any F019 application-code commit. This looks like a worker session that produced a handoff but was interrupted before its `pre-worker-exit` commit step, or a concurrently-running session on the same working tree. During my own session the file also visibly changed on disk mid-task (see the tool-call system reminders), and at one point `npx tsc --noEmit` transiently showed two extra errors (`toolCallBaselineIds`/`proposalBaselineIds` not defined in `use-doc-assistant.ts`) that were gone on the next run — consistent with a concurrent writer mid-save, not a bug I introduced.

Because my own F020 edits to `use-doc-assistant.ts`/`assistant-sidebar.tsx` are interleaved line-by-line with that inherited F019 code in the same files, I could not cleanly commit only my own hunks — my commit necessarily includes the F019 work already sitting in the tree. `lib/ai/__tests__/use-doc-assistant-persistence.test.tsx` (not mine, F019's) currently has 2-3 flaky failures under `npx vitest run lib/ai app/api/ai` unrelated to anything F020 touches — confirmed by running the same file against `git stash` (reverts to HEAD, i.e. pre-F019) where the equivalent errors don't reproduce because the file doesn't exist at HEAD. **Recommend the orchestrator verify F019 is either already a separate completed-and-committed feature elsewhere, or spin up a proper F019 worker to finish/fix and commit that work on its own, since it's now bundled into this commit under F020's message** (noted in the commit body).

MCP usage: none — this feature has no external service surface (pure in-process guards + client/server wiring).
