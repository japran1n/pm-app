# Handoff: F18 — Rollup zbir i oznaka izvora u `page-column-header.tsx`

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to F18 in validation-contract.md — the feature spec's "Definition of done" is a checklist (below), not assertion IDs. All checklist items verified manually:
- `page-column-header.tsx` accepts optional `showDetails` and `rollup` props — PASS
- Rollup total + source label render only when `showDetails === true` and `rollup` exists and `rollup.source !== "none"` — PASS
- `Σ` prefix shown only for `rollup.source === "rolled"`, no prefix for `"own"` — PASS
- `conflicts` renders the "· sections Xm" trailing note — PASS
- TypeScript build passes for all files this feature touched — PASS

## Files changed
components/architecture/page-column-header.tsx
components/architecture/page-column.tsx
components/architecture/board.tsx

## Commands run
`npx tsc --noEmit` (1 — but the only remaining error is in components/architecture/sitemap-io-dialog.tsx, a file this feature does not touch; confirmed pre-existing/unrelated, belongs to concurrent F22 work in progress on disk, see Notes)
`git commit` (0)

## Decisions made
- `EstimateRollup` type is defined in `lib/architecture/types.ts`, not `lib/architecture/estimate-rollup.ts` (which only re-uses it via `import type`). The spec's prop signature referenced `estimate-rollup.ts` but that module doesn't export the type itself, so imports were pointed at `@/lib/architecture/types` instead — same type, correct module, avoids a TS2459 "declares locally but not exported" error.
- `board.tsx` already had `showDetails`/`detailsData` props (from F15) but they were unused (prefixed `_showDetails`/`_detailsData`). Wired them up: added `computeRollups(pages, detailsData)` (only when `showDetails && detailsData`, to avoid the compute cost in the default view) and passed `showDetails` + the per-page `rollup` down through `PageColumn` to `PageColumnHeader`.
- `PageColumnHeader`'s non-editing render was a bare `<p>`; wrapped it in a `<div className="min-w-0 flex-1">` so the rollup block can sit below the title as a sibling, moving the `min-w-0 flex-1` layout classes from the `<p>` to the new wrapper div so the flex layout in `page-column.tsx`'s header row is unaffected.
- Rollup block placed only in the non-editing branch, per the spec's explicit instruction (renaming and rollup display are mutually exclusive UI states).
- `page.sections.length > 0` guard added around the "(N sections)" note (not in the literal spec snippet, but keeps a rolled rollup with a since-emptied section list from showing "(0 sections)").

## Out-of-scope work needed
- Section-level `showDetails`/`detailsData` threading (SectionCard's estimate chip, per grep) does not currently receive these props anywhere in `board.tsx` → `PageColumn` → `SortableSectionList` → `SectionCard`. That wiring is out of scope for F18 (header-only) and appears to belong to whatever feature owns `estimate-chip.tsx` (already implemented per its own header comment referencing "F17 scope") — if it isn't already wired by another in-flight feature, a follow-up should thread `showDetails`/relevant per-section details through that chain the same way this feature threaded rollups to the header.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Pointed the `EstimateRollup` type import at `@/lib/architecture/types` instead of `@/lib/architecture/estimate-rollup` as literally written in the spec, because the latter module does not export the type (verified via `npx tsc --noEmit`, TS2459). Same type, correct source module — no behavior change.
AUTONOMOUS_DECISION: Added `page.sections.length > 0` guard on the "(N sections)" note so a rolled rollup never displays "(0 sections)" — not specified but consistent with the "no rollup label when nothing to report" intent already covered by the `rollup.source !== "none"` guard.

## Notes for the next worker
- While working, a concurrent process (likely another in-flight worker) had an uncommitted, in-progress edit to `components/architecture/sitemap-io-dialog.tsx` on disk (adding `"brief-md"`/`"brief-json"` cases referencing `toCopyBriefMarkdown`/`toCopyBriefJson`/`detailsData`, none of which exist yet in that file — it does not currently compile). This file was intentionally left untouched and unstaged by this worker's commit; the `tsc --noEmit` failure in that file is unrelated to F18 and was pre-existing on disk before this worker started (confirmed by inspecting the diff, which does not intersect any file this feature touched).
- No MCP tools used — this is a pure client-component/presentational feature with no external service dependency, per `worker-mcp-usage` skill's decision tree ("Pure UI feature → No MCP").
