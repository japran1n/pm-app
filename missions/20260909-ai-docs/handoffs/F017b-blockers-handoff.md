# Handoff: F017b — Fix M3 scrutiny BLOCKERs

## Status
COMPLETE

## Assertions covered
AS-065: PASS — both Accept handlers (`proposal-card.tsx`) now have a `catch` that sets `applyError` on a thrown server action, in addition to the existing `{ ok: false } / { error }` handling; new tests `test_B1_accept_shows_applyError_and_does_not_call_onAccept_when_the_server_action_throws` (doc_edit) and `test_B1_accept_shows_applyError_when_the_server_action_throws` (doc_create), plus the matching `{ ok: false }` / `{ error }` variants, confirm `applyError` is set and Accept is never called again for that outcome.
AS-009: PASS — `applyDocCreateProposal` no longer leaves an orphan "Untitled" row: title is validated before `createDoc`, and the stub row is deleted if `updateDoc` subsequently fails. Covered by `test_B2_blank_title_is_rejected_before_createDoc_is_called_zero_orphan_rows` and `test_B2_returns_the_updateDoc_error_and_deletes_the_orphaned_stub_row_when_the_content_write_fails`.
AS-028: PASS — `propose-doc-edit.test.ts`'s cross-workspace test now mocks at the Supabase query-builder level (matching `get-current-doc.test.ts`'s pattern) and lets the REAL `get_current_doc.run` execute, so `propose_doc_edit`'s isolation genuinely depends on `get-current-doc.ts:104`'s `data.workspace_id !== workspaceId` check. Mutation-verification evidence below (break -> red -> restore -> green).

## Files changed
components/ai/proposal-card.tsx
components/ai/__tests__/proposal-card.test.tsx
lib/actions/ai-proposals.ts
lib/actions/__tests__/ai-proposals.test.ts
lib/ai/tools/propose-doc-edit.ts
lib/ai/tools/__tests__/propose-doc-edit.test.ts

## Commands run
`npx vitest run lib/ai components/ai lib/actions/__tests__/ai-proposals.test.ts` (0) — 12 files, 121 tests, all passed
`npx vitest run lib/ai` (0) — 10 files, 92 tests, all passed
`npx vitest run lib/ai/tools/__tests__/no-writes.test.ts` (0) — 1 file, 4 tests, all passed
`npx tsc --noEmit` (1, but only the same 4 pre-existing errors: `app/layout.tsx(29,50)`, `components/ui/status-badge.tsx(45,62)`, `tests/unit/docs-markdown-editor-export-import.test.tsx(75,18)` and `(75,48)` — none new, none in M3 paths)
`npx eslint .` (0) — 26 warnings, identical set to the scrutiny report's baseline, none in `lib/ai/**`, `components/ai/**`, or `lib/actions/ai-proposals.ts`

## Decisions made
- B1: added a `catch (err)` block to both `handleAccept` functions in `proposal-card.tsx` that logs via `lib/observability/logger` and sets a new `GENERIC_APPLY_ERROR_MESSAGE` ("Something went wrong. Please try again in a moment.") into `applyError`. The existing `{ ok: false }` / `{ error }` handling was already present and correct — only the missing `catch` was the gap. Button disabling on terminal outcomes was already correct via the separate accepted/rejected render branches; no change needed there.
- B2: validated `title.trim()` in `applyDocCreateProposal` BEFORE calling `createDoc` (fast-path, zero writes for a blank title). For the remaining failure mode (successful `createDoc`, failing `updateDoc`), added a direct Supabase `.from("docs").delete().eq("id", created.id)` call to remove the orphaned stub row — this file is a server action, not a tool under `lib/ai/tools/**`, so the AS-003 no-writes-from-AI-layer guard does not apply to it (confirmed by re-reading `no-writes.test.ts`'s AST walk scope, which starts at `lib/ai/tools/**`/`lib/ai/docs-agent.ts`/`app/api/ai/docs/route.ts` only). Delete failure is logged but still returns the original `updateDoc` error to the caller (best-effort cleanup, not a second failure mode surfaced to the user).
- B3: restructured `propose-doc-edit.test.ts` to mock `@/lib/supabase/server` (the same collaborator `get-current-doc.test.ts` mocks) instead of mocking `@/lib/ai/tools/get-current-doc` directly. `propose_doc_edit`'s `run` now calls the REAL `get_current_doc.run` in every test in this file, so the cross-workspace test genuinely exercises `get-current-doc.ts:104`'s isolation check. Every other test in the file was rewritten to stub the raw Supabase `docs` row instead of a `ToolResult` envelope, since `get_current_doc` is no longer mocked.
- H1: added a `message.stop_reason !== "end_turn"` check immediately after the model call in `propose-doc-edit.ts`, returning `err("model_error", "Document generation was cut off — please try again.")` before touching `message.content` at all.
- H2: destructured `truncated` from `get_current_doc`'s result and return `err("document_too_large", ...)` before ever calling the model, rather than proposing against a silently-truncated base.
- H3: chose "escape `<` as `&lt;`" over a random-delimiter/UUID-fence scheme (spec offered either) — simplest fix, no new state to thread through, and neutralises both opening and closing tag breakout attempts uniformly, not just the one documented closing tag. Applied only to the interpolated copy used in the user turn (`escapedCurrentMarkdown`); the `currentMarkdown` field returned in the proposal envelope (used by F016's staleness check) is left untouched, since that check compares against the live DB row's raw content.

## Out-of-scope work needed
The MEDIUM and LOW findings in M3-SCRUTINY.md were explicitly out of scope for this fix pass (only BLOCKERs + HIGH were assigned) and were not touched:
- `ai-proposals.ts:101-105` TOCTOU staleness guard (no CAS predicate on `updateDoc`).
- `ai-proposals.ts:177` `workspaceId` from client payload reaching `createDoc` with no application-layer membership check beyond RLS.
- `ai-proposals.ts:175-177` `folderId` not re-validated against the workspace at accept time (draft-time cross-workspace check doesn't survive the round trip).
- `no-writes.test.ts:88-95` AST walk blind to computed/element-access callees (`obj["update"](...)`).
- `propose-doc-edit.ts:94-98` `unwrapMarkdownFence` unconditionally strips fences even for a doc that legitimately is one fenced block.
- `propose-doc-edit.ts:145` no `AbortSignal`/timeout on the internal model call (AS-027).
- `proposal-card.tsx:316` double-click guard rests on a stale-closure `isApplying` read rather than a `useRef` latch.
- `proposal-card.test.tsx` — no assistant-sidebar-level test proving the click→collapse wiring through the real `onAccept={acceptProposal}` callback (currently only unit-tested at the `ProposalCard` boundary).
- `create-doc.ts:19-27,62-66` header comment claims an `.eq("workspace_id", ...)` filter that is actually a post-fetch JS compare.
- No test for `folder_fetch_failed`; no size bound on `title`/`markdown`.
- `diff-view.tsx:78` unbounded row rendering for whole-doc rewrites.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: For H3, chose simple `<` -> `&lt;` escaping over a UUID-fence delimiter scheme (both were offered as acceptable options in the mission brief) — it required no new state, handles both `<current_document_markdown>`-style and any other tag-shaped breakout attempt in the document body uniformly, and keeps the fix contained to one line at the interpolation site.
AUTONOMOUS_DECISION: For B2's orphan-cleanup delete failure, chose to log-and-continue (returning `updateDoc`'s original error) rather than surfacing a compound "created but also failed to clean up" error to the user — the user-facing error is not actionable either way, and a failed delete just means a harmless orphan row that existing app UI (delete doc) can already handle, consistent with the tradeoff `applyDocCreateProposal`'s own header comment previously accepted before this fix.

## Notes for the next worker
- Mutation-verification evidence for B3 (recorded during this session, not left in the repo): temporarily changed `lib/ai/tools/get-current-doc.ts:104` from `if (!data || data.workspace_id !== workspaceId)` to `if (!data)` (i.e. deleted the isolation check) and re-ran `npx vitest run lib/ai/tools/__tests__/propose-doc-edit.test.ts` — the cross-workspace test (`test_F027_AS_028_cross_workspace_doc_is_not_visible_and_never_reaches_the_model`) went RED, returning `status: "ok"` with the foreign workspace's title/content/diff instead of the expected `status: "empty"`/`not_found`. Reverted the file to its original content and re-ran the same command — 12/12 GREEN. This proves the test's isolation assertion is load-bearing against the real code path, not a mock artifact.
- `lib/observability/logger.ts` is safe to import from a `"use client"` component (`proposal-card.tsx`) — it branches on `process.env.NODE_ENV` and falls back to `console.*`, no server-only APIs.
- No MCP tools were used for this fix pass — all changes are pure application code + unit tests, no live Supabase schema/policy introspection was needed (the delete-on-cleanup call in `ai-proposals.ts` reuses the existing `createClient()` RLS-scoped pattern already established in that file).
