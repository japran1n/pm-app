# Handoff: F002 — Tool result envelope + shared schemas

## Status
COMPLETE

## Assertions covered
AS-021: PASS — `lib/ai/tools/types.ts` exports `ToolResult<T>` as the discriminated union `ToolOk<T> | ToolEmpty | ToolError` exactly matching the spec's contract; `npx tsc --noEmit` accepts the shapes.
AS-027: PASS — `DocEditProposal` and `DocCreateProposal` are exported with exactly the fields in the spec (including `currentMarkdown`), and `ToolEmpty`/`ToolError` distinguish "empty" (normal) from "error" (exceptional) as required.
AS-105: PASS (shape-level) — `ToolError.message` is documented as required to be user-safe (never a key/token/connection string/raw Postgres error); this feature is types-only so there is no runtime error-translation logic here yet to fully exercise, but the type and its doc comment are in place for later features to follow.

## Files changed
lib/ai/tools/types.ts

## Commands run
`npx tsc --noEmit` (0 errors attributable to this change; 3 pre-existing unrelated errors in components/ui/status-badge.tsx and tests/unit/docs-markdown-editor-export-import.test.tsx, same baseline noted in F001's handoff)
`npm run lint` (0 errors; 26 pre-existing warnings, all in unrelated test files, none new and none in lib/ai/)

## Decisions made
- Added `ok`, `empty`, `err` constructor helpers since later tool-implementation features (F003+) will construct many `ToolResult` values and these remove obvious repetition without building any framework around them — each is a one-line pass-through.
- Put the "don't leak not_found vs not_visible in `message`" rule as a standalone doc comment attached to `ToolEmpty` (rather than folding it into the type's own comment) so it reads as a rule for *callers* of the type, matching how `lib/actions/docs.ts`'s header comments explain caller-facing invariants, not just what the type is.
- Did not add any Zod schema for tool inputs (out of scope per spec — those live with each tool in F003+).

## Out-of-scope work needed
- No tool implementations exist yet; F003 onward will import `ToolResult`, `ToolEmpty`, `ToolError`, `DocEditProposal`, `DocCreateProposal`, `ok`, `empty`, `err` from `lib/ai/tools/types.ts`.
- F016 (apply-proposal flow) will need to compare a live-refetched document's markdown against `DocEditProposal.currentMarkdown` before applying `proposedMarkdown` — this feature only defines the field, the comparison logic itself is F016's job.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec's contract was unambiguous; only decision was the constructor-helper addition, documented above under Decisions made, which the spec explicitly permitted at worker discretion)

## Notes for the next worker
- Import types/helpers from `lib/ai/tools/types.ts`; nothing in this file is server-only, so it's safe to import from client components too (e.g. for typing proposal cards in the UI) as well as from tool implementations and the route handler.
- No MCP tools were used for this feature — it is pure TypeScript types with no external service or database interaction.
