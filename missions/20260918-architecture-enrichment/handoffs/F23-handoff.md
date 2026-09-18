# Handoff: F23 — Copy brief export formats in sitemap-io-dialog

## Status
COMPLETE

## Assertions covered
No F23 feature spec file, clarification file, or validation-contract.md exists in
missions/20260918-architecture-enrichment/ (only F01-F22 have spec files; the
mission has no plan.md or validation-contract.md at all). No assertion IDs were
assigned to F23 to verify against. Implementation follows the task instructions
given directly in the prompt.

## Files changed
components/architecture/sitemap-io-dialog.tsx
components/architecture/canvas-board.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Added `exportOnly?: boolean` flag to the `FORMATS` entry type and set it on the
  two new `brief-md` / `brief-json` entries. The import tab has no format
  selector (it accepts a file/paste and auto-detects via `parseSitemap`), so the
  export-only flag is documentation/future-proofing rather than an active filter,
  but it guarantees the two new formats can never leak into any future
  import-format UI without an explicit opt-in.
- `serialise()` calls `toCopyBriefMarkdown` / `toCopyBriefJson` from
  `lib/architecture/copy-brief.ts` (already built in F22) with
  `detailsData ?? new Map()` so the dialog works even when the details toggle is
  off and `detailsData` is null/undefined — per the copy-brief.ts contract this
  renders `_No brief yet._` for every node, which is correct empty-state
  behaviour per the task spec.
- Download filename branches on format: brief formats get
  `<project-slug>-copy-brief.<ext>`, all other formats keep the existing
  `<project-slug>-sitemap.<ext>` pattern.
- Threaded `detailsData` from `CanvasBoard`/`SitemapCanvas` (which already
  declared `detailsData?: ArchitectureNodeDetails | null` as a prop on
  `CanvasBoard` per earlier F-series work) down into `SitemapIoDialog`. This
  required adding `detailsData` to the `SitemapCanvas` inner component's
  destructured props/type as well, since it previously only spread into
  `CanvasBoard`'s JSX without being consumed by the inner component.
- `projectName` was already an existing prop on the dialog; used
  `(projectName || "site")` fallback per task guidance for a fallback value.

## Out-of-scope work needed
- `SitemapCanvas`/`CanvasBoard` also declares a `showDetails` prop that is
  still unused inside `SitemapCanvas` — not touched, out of scope for F23.
- No missions/20260918-architecture-enrichment/plan.md, tech-decisions.md, or
  validation-contract.md exist. If this mission is meant to track F23 formally,
  a future step should add a feature spec file and validation-contract entries
  for it so scrutiny/UX validators have something concrete to check.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: No F23-*.md spec file or clarification file exists in the
mission directory, so I implemented directly from the task instructions given
in the prompt (which fully specified the format values, labels, serialize
logic, and prop threading). No assertion IDs exist to reference, so the
"Assertions covered" section documents this gap instead of listing IDs.

## Notes for the next worker
- `lib/architecture/copy-brief.ts` (from F22) exports `toCopyBriefMarkdown` and
  `toCopyBriefJson`, both `(pages, details, opts?)` where `opts.pageSlug` can
  filter to a single page — not exposed in the dialog UI since the task didn't
  ask for a per-page export option.
- The import tab in `sitemap-io-dialog.tsx` never rendered a format picker to
  begin with (it accepts a file upload / pasted text and calls `parseSitemap`
  which auto-detects XML/JSON/plain-list), so "brief formats not in import tab"
  was already satisfied structurally; the `exportOnly` flag on `FORMATS`
  entries is there so any future import-format UI reads it correctly.
