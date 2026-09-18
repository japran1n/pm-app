# Handoff: F24 — Per-page scope for copy brief export

## Status
COMPLETE

## Assertions covered
None found — no `missions/20260918-architecture-enrichment/features/F24-*.md`, `clarifications/F24-clarification.md`, `plan.md`, or `validation-contract.md` exist in this mission directory to assign assertion IDs. Implemented directly from the task instructions provided in the prompt.

## Files changed
components/architecture/sitemap-io-dialog.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- `lib/architecture/copy-brief.ts` (`toCopyBriefMarkdown` / `toCopyBriefJson`) already accepted `opts?: { pageSlug?: string }` and filtered pages correctly (implemented in F22) — no changes needed there.
- `sitemap-io-dialog.tsx` already receives the full `pages: BoardPage[]` prop, so threading page scope in was straightforward — went with the full implementation (option 2 in the task), not the minimal no-op fallback.
- Added a `<select id="brief-page-scope">` "Page" dropdown that renders only when `format` is `brief-md` or `brief-json`, defaulting to `"__all__"` (All pages). Options are built from `pages.map(p => ({title, pageSlug}))` — no dependency on `detailsData`.
- Threaded `briefOpts = { pageSlug }` (or `undefined` when "All pages" is selected) into `toCopyBriefMarkdown`/`toCopyBriefJson` in `serialise()`.
- Download filename gets a page suffix appended (e.g. `site-copy-brief-about.md`) when a specific page is scoped, derived by stripping leading `/` and replacing remaining `/` with `-` in the slug; falls back to `home` for the root slug `/`.
- Left XML/CSV/MD/JSON (non-brief) formats untouched — scope selector is brief-only per the task spec.

## Out-of-scope work needed
- No `plan.md`/`validation-contract.md` exist for this mission yet, so this feature has no formally assigned assertion IDs. If the mission intends to track this behaviourally, a follow-up should add assertions for "brief export can be scoped to a single page" and "page scope selector only shows for brief formats" to a validation contract once one exists.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No F24 feature spec/clarification file was present in the mission directory, so I followed the task prompt's own spec verbatim (option 2: full page-scope selector in the dialog, since `pages` was already available as a prop) rather than falling back to the minimal no-op approach described as a last resort.

## Notes for the next worker
- `pages` prop passed to `SitemapIoDialog` is `BoardPage[]` with `id`, `title`, `pageSlug`, `pageKind`, `sections` — used directly for the select options, no new data fetch needed.
- The root page's slug is likely `/`; the download-filename suffix logic handles that by producing `-home` instead of an empty/`-` suffix.
- No MCP tools were needed for this feature (pure client-side UI/string logic, no external service state).
