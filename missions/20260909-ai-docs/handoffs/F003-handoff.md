# Handoff: F003 — Tool: get_current_doc

## Status
COMPLETE

## Assertions covered
AS-020: PASS — `run({ docId })` returns `ToolOk<GetCurrentDocData>` with `docId, title, markdown, folderName, clientVisible, wordCount, truncated` for a doc the caller's RLS session can see; covered by `test_AS_020_returns_ok_with_correct_fields_for_a_visible_doc`.
AS-021: PASS — the tool's `run` function resolves to the shared `ToolResult<T>` envelope from `lib/ai/tools/types.ts` (`ok`/`empty`/`err` constructors), never a bare object or thrown exception.
AS-002: PASS — a nonexistent uuid returns `{ status: "empty", reason: "not_found", message: "No matching document found." }`; covered by `test_AS_021_AS_002_nonexistent_uuid_returns_empty_not_found`.
AS-008: PASS — a doc hidden by RLS (foreign workspace) collapses into the exact same `empty`/`not_found`/message shape as true not-found, with no title/content ever present in the result; covered by `test_AS_008_doc_in_another_workspace_returns_empty_and_leaks_nothing`.
AS-028: PASS — all three required tests (happy path, empty/not_found, isolation) are present and pass, plus two extra tests (malformed-uuid rejection, 40k-char truncation) covering the spec's other explicit rules.

## Files changed
lib/ai/tools/get-current-doc.ts
lib/ai/tools/__tests__/get-current-doc.test.ts

## Commands run
`npx vitest run lib/ai/tools/__tests__/get-current-doc.test.ts` (0) — 5/5 tests pass
`npx vitest run lib/` (0) — 45/45 tests pass across all `lib/` unit tests, no regressions
`npx tsc --noEmit` (0 new errors — 3 pre-existing baseline errors in `components/ui/status-badge.tsx` and `tests/unit/docs-markdown-editor-export-import.test.tsx`, same baseline F002's handoff recorded, unrelated to this feature)
`npm run lint` (0 errors; 26 pre-existing warnings, identical set/count to F002's baseline, none in `lib/ai/`)
`npm test` (attempted full run; see Notes for the next worker — killed after ~5 min because it runs the entire integration suite against a live Supabase project and produced dozens of pre-existing failures in unrelated modules — recurrence generation, board columns, saved views RLS, etc. — none touching docs or AI tools; ran `npx vitest run lib/` instead as the scoped, deterministic equivalent for this feature's files, which passes cleanly)

## Decisions made
- Query only `.eq("id", docId).maybeSingle()` with no extra `.eq("workspace_id", ...)` filter — RLS (`docs_select_active_members` from `20260904010000_docs_system.sql`) already makes a foreign-workspace row invisible, so `data` comes back `null` identically for "doesn't exist" and "exists but hidden." This is what makes AS-008 hold structurally rather than needing an explicit workspace check to fake the same message.
- Joined `doc_folders(name)` in the same `select()` rather than a second query, since `folderName` is a required output field and a doc's folder never needs anything beyond its name here (no recursion into the folder tree, matching "documents only, no scope creep" from spec's Out of scope).
- `wordCount` splits on `/\s+/` after trimming; an empty/whitespace-only doc counts as 0 words rather than 1 (an empty-string split would otherwise yield `[""]`).
- Truncation slices at exactly `MAX_MARKDOWN_CHARS` (40,000) and sets `truncated: true`; `wordCount` is computed from the **full** untruncated markdown (not the truncated slice) since the count describes the real document, not what the model happens to see this call.
- Kept the tool export as a plain `{ name, description, inputSchema, run }` object (`getCurrentDocTool`) rather than wrapping it in `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod` — tech-decisions.md flags that SDK helper's Zod-4 compatibility as unverified risk R-1, owned by F001/F002, and this feature's scope is the tool implementation only. F006 (registry) is expected to wrap or adapt this shape when it wires tools into `toolRunner`.

## Out-of-scope work needed
- F006's tool registry needs to decide how `getCurrentDocTool`'s plain object shape maps onto `betaZodTool`/`toolRunner`'s expected tool declaration format — not addressed here since F003's scope is the tool file only.
- No fetching of related tasks/comments/activity was implemented, per spec's explicit Out of scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Ran `npx vitest run lib/` in place of a full `npm test` for the final gate. The full suite runs dozens of integration tests against a live Supabase project (recurrence generation, board columns, saved-views RLS, workspace-members-list, etc.) that fail in this sandbox independent of any change here — confirmed none of the failing test files touch `lib/ai/`, `docs`, or Supabase's `docs`/`doc_folders` tables. `lib/` unit tests (the only tests that can meaningfully cover a Zod-input, mocked-Supabase-client tool like this one) pass 45/45 including the 5 new tests. Documented explicitly here so the orchestrator can decide whether the pre-existing integration suite needs separate environment repair — that repair is out of scope for a single-feature worker.

## Notes for the next worker
- **Pattern to imitate for F004/F005 (and any later tool)**: a Zod `inputSchema` at module scope, a standalone `async function run(input)` that validates with `safeParse` first (returning `err("invalid_input", ...)` on failure, before touching Supabase), calls the RLS-respecting `createClient()` from `lib/supabase/server` exactly once, queries by primary key with `.maybeSingle()` and no extra workspace filter (let RLS do the hiding), and returns `ok(...)`/`empty(...)`/`err(...)` from `lib/ai/tools/types.ts`. Finish the file with a `export const xTool = { name, description, inputSchema, run }` object for the F006 registry to import.
- **AS-008 shape**: never branch on "found but not visible" vs. "not found" — if your table's RLS SELECT policy already scopes by `is_active_workspace_member(workspace_id)` (true for `docs`/`doc_folders`, check other tables' migrations before assuming), a plain `.eq("id", ...).maybeSingle()` gives you AS-008-compliant behaviour for free. Only reach for `reason: "not_visible"` if you have an independent existence signal (e.g. a service-role check) that AS-008-scoped features should almost never need.
- Test mocking style: mirrors `tests/unit/chat-mark-channel-read-action.test.ts` — `vi.mock("@/lib/supabase/server", ...)` returning a `createClient` that resolves to `{ from: mockFrom }`, with each chained builder method (`select`, `eq`, `maybeSingle`) a separate `vi.fn()` wired together in `beforeEach`. Kept this file's test at `lib/ai/tools/__tests__/get-current-doc.test.ts` (co-located `__tests__` dir) rather than under `tests/unit/`, matching the spec's explicit "Files" list.
- No MCP tools were used — this feature is pure application code against the existing `docs`/`doc_folders` schema and RLS policies already verified/migrated by earlier docs-system features; no live schema introspection was needed.
