# Handoff: F019 — Thread persistence

## Status
COMPLETE

## Assertions covered
AS-082: PASS — mount loads the most recent thread for the workspace via `getRecentThread(workspaceId)` and hydrates `messages`/`toolCalls`/`proposals` in order. `test_AS_082_mount_loads_the_most_recent_thread_and_restores_messages_in_order` in `lib/ai/__tests__/use-doc-assistant-persistence.test.tsx`.
AS-083: PASS — `reset()` ("New chat") clears `threadIdRef` so the next `send()` calls `createThread` again (a genuinely new row); the prior thread's messages are untouched. `test_AS_083_new_chat_reset_makes_the_next_send_create_a_new_thread`.
AS-084: PASS — the user turn persists via `addMessage` before the stream resolves (asserted while the stream is still gated); the assistant turn persists with tool calls and proposals once the stream reaches `done`, and a stopped (aborted) turn still persists whatever partial content streamed before the abort. `test_AS_084_send_persists_the_user_turn_immediately_before_the_stream_resolves`, `test_AS_084_assistant_turn_persists_with_tool_calls_and_proposals_on_done`, `test_abort_still_persists_the_partial_assistant_content`.
AS-085: PASS — `acceptProposal`/`rejectProposal` call `updateProposalState` after the in-memory transition, and a proposal hydrated already `accepted`/`rejected` never re-arms (`status !== "pending"` guard). `test_AS_085_accepting_a_proposal_persists_its_settled_state`, `test_AS_085_a_hydrated_accepted_proposal_never_re_arms_accept`. Fixed a real bug in this session (see Decisions made) that made this the one previously failing.

## Files changed
lib/actions/ai-threads.ts (fixed `updateProposalState`'s `state`→`status` key bug; already existed from prior uncommitted work bundled into F020's commit)
lib/ai/use-doc-assistant.ts (fixed the AS-085 `didTransition` timing bug in `acceptProposal`/`rejectProposal`; removed a now-unnecessary eslint-disable directive; rest of the persistence wiring — hydration effect, `createThread`/`addMessage` calls in `send()`, `reset()` clearing `threadIdRef` — already existed from prior uncommitted work bundled into F020's commit, see Notes)
lib/ai/__tests__/use-doc-assistant-persistence.test.tsx (new test file for AS-082/083/084/085 already existed from prior uncommitted work; this session fixed a `tsc` narrowing error on `releaseStream` and removed debug `console.log` statements used while diagnosing the AS-085 bug)
supabase/migrations/20261119010000_ai_messages_update_proposal_state.sql (new — adds the missing `ai_messages` UPDATE RLS policy; see Decisions made)

## Commands run
`npx vitest run lib/ai` (0 — 118/118 tests pass across 14 files)
`npx tsc --noEmit` (0 new errors — exactly the same 4 pre-existing errors as baseline: `app/layout.tsx` LayoutProps, `components/ui/status-badge.tsx` overload, `tests/unit/docs-markdown-editor-export-import.test.tsx` x2)
`npx eslint lib/actions/ai-threads.ts lib/ai/use-doc-assistant.ts lib/ai/__tests__/use-doc-assistant-persistence.test.tsx lib/ai/__tests__/use-doc-assistant.test.tsx lib/ai/__tests__/use-doc-assistant-proposals.test.tsx` (0)
`npx vitest run tests/unit/f009-assistant-sidebar.test.tsx` (0 — 10/10, confirms the sidebar itself needed no edits)
`git commit` (0)

## Decisions made
- **AS-085 root cause and fix**: `acceptProposal`/`rejectProposal` previously set a closure-local `didTransition` flag *inside* the `setProposals(updater)` callback and then read it *immediately after* calling `setProposals`, synchronously, in the same tick. React does not invoke a `setState` updater function until the render phase — it does not run eagerly at the call site — so `didTransition` was always still `false` at the point it was checked, and `persistProposalState`/`updateProposalState` were never called in practice (confirmed via targeted debug logging: `addMessage` for the assistant turn resolved and correctly populated `proposalLocationRef`, yet `persistProposalState` itself was never entered). Fixed by calling `persistProposalState(id, state)` from *inside* the updater, at the exact point the transition is known to have actually happened — no reliance on reading React state synchronously outside the render cycle.
- **`state` vs `status` key bug in `updateProposalState`**: the action patched the matched proposal object with `{ ...proposal, state }`, but every proposal object in this codebase (`ProposalView`, and what `addMessage`/hydration actually read) uses the key `status`. Fixed to `{ ...proposal, status: state }` — otherwise a settled decision would have silently failed to round-trip through hydration even with the AS-085 bug above fixed, since the hydration path only ever reads `.status`.
- **Added a migration for a missing `ai_messages` UPDATE RLS policy** (`supabase/migrations/20261119010000_ai_messages_update_proposal_state.sql`), which is outside this feature's originally declared file scope (`lib/actions/ai-threads.ts` + `use-doc-assistant.ts` + sidebar) but was necessary to make AS-085 actually function in production, not just against mocks: F018's migration (`20261118010000_ai_threads_ai_messages.sql`) shipped `ai_messages` as strictly append-only, with an explicit comment stating no UPDATE policy exists. Postgres RLS with zero matching policies for an operation means that operation silently affects 0 rows — no error is raised, so `updateProposalState`'s `.update(...)` call would succeed at the application layer while never actually persisting anything, and a reload would re-arm Accept for every proposal, which is exactly the failure mode AS-085 exists to prevent. The new policy mirrors the exact role gate (`is_active_workspace_member` + `can_write_workspace_docs`, joined through the parent thread) already used by every other write policy on this table, so it introduces no new authorization surface.
- Left `components/ai/assistant-sidebar.tsx` untouched: it already destructures and renders `messages`/`toolCalls`/`proposals`/`reset` from `useDocAssistant`, and its own test suite (`tests/unit/f009-assistant-sidebar.test.tsx`, 10/10) passes unmodified — hydration and persistence are entirely internal to the hook, so no sidebar-side change was needed to satisfy this feature's assertions.

## Out-of-scope work needed
None identified beyond the RLS migration already added above (which was necessary, not optional, for this feature's own correctness — see Decisions made).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: added the `ai_messages` UPDATE RLS migration even though it is outside this feature's literally-declared "Touches" (lib/actions/ai-threads.ts, use-doc-assistant.ts, sidebar) — without it, AS-085 cannot actually pass against a real database (see Decisions made for the full reasoning). Judged this as within scope in spirit since AS-085 is explicitly assigned to F019 and the spec itself flags it as "the assertion most likely to be missed."
AUTONOMOUS_DECISION: did not modify `components/ai/assistant-sidebar.tsx` despite the spec's "Files" section mentioning "edits to ... the sidebar" — verified via its own passing test suite that the existing `reset`/`messages`/`toolCalls`/`proposals` wiring already satisfies every assertion; no additional sidebar change was identifiable as required.

## Notes for the next worker
This feature's application code (`lib/actions/ai-threads.ts`, the persistence wiring in `lib/ai/use-doc-assistant.ts`, and `lib/ai/__tests__/use-doc-assistant-persistence.test.tsx`) was already present, uncommitted, in the working tree when this session started, and had already been swept into F020's commit (`dc676b7c`, see that feature's own handoff for the full account of how that happened — a prior F019 worker session was apparently interrupted before its own `pre-worker-exit` commit step). This session's job was narrower than a full F019 implementation: diagnose and fix the one genuinely broken assertion (AS-085), fix a latent correctness bug that would have silently defeated AS-085 in production (the RLS UPDATE policy gap), and produce this feature's own commit + handoff so F019 has a clean, attributable record independent of F020's bundled commit.

No MCP tools were used — `mcp-registry.md`/connections/README.md for this mission states no MCP server is needed (the Anthropic API and Supabase are consumed as libraries from server-side app code, not as agent tools).
