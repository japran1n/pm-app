# Handoff: F009 — Sitemap export CMS detection

## Status
COMPLETE

## Assertions covered
AS-036: PASS — `toJson` output now includes `hasCmsSections` on every page object (verified via new test in tests/unit/sitemap-io.test.ts).
AS-037: PASS — new test asserts `hasCmsSections` is false for a page with no sections, false for a page with only static sections, and true for a page with at least one section where `kind === 'cms'`.

## Files changed
lib/architecture/sitemap-io.ts
tests/unit/sitemap-io.test.ts

## Commands run
`npx vitest run tests/unit/sitemap-io.test.ts` (0) — 26 passed
`npx tsc --noEmit -p .` (0)
`npx vitest run tests/unit/f039-portal-guards.test.ts` against unmodified HEAD via `git stash` (pre-existing failure, unrelated to this change — confirms regression is not caused by F009)

## Decisions made
- Added `hasCmsSections: boolean` to the `SitemapJson` page type and computed it in `toJson` as `page.sections.some((s) => s.kind === "cms")`, matching the existing `BoardSection.kind` field already produced by `lib/queries/architecture.ts` (`section_kind === "cms" ? "cms" : "static"`).
- Did not touch `toCsv`, `toMarkdown`, or `toSitemapXml` — spec scoped this to "page-level export output" and the clarification implies the JSON export (the only format with a full page-object shape); CSV/XML/Markdown are line/tree formats without a structured page object, and F010 (regression guard) only concerns non-CMS pages being unaffected, which holds since `hasCmsSections` is purely additive to `toJson`.
- `parseSitemap`/`parseJson` intentionally ignore the new field (its `ParsedPage`/`SitemapJson` parsing path only reads `path`/`title`/`kind`), so round-trip import behavior and existing "toJson round-trips" test are unaffected — confirmed by running the full pre-existing test file, all 26 tests pass including untouched ones.

## Out-of-scope work needed
None identified specific to F009. F010 (regression guard) should verify non-CMS pages still export identically aside from the added field.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Scoped `hasCmsSections` addition to the JSON export (`toJson`/`SitemapJson`) only, since it is the sole export format with a structured per-page object; CSV/Markdown/XML formats are row/line/tree based and the spec's "page-level export output" most naturally maps to the JSON page objects.

## Notes for the next worker
- `BoardSection.kind` is already `'cms' | 'static'` per `lib/queries/architecture.ts:149`; no query changes were needed.
- Full repo test suite (`npx vitest run`) has several pre-existing failures unrelated to this feature (realtime hooks, portal guards, list-table realtime) — verified via `git stash` that these fail identically on unmodified HEAD, so they predate this change and are out of scope for F009.
