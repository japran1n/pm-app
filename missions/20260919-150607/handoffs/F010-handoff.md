# Handoff: F010 — Regresija exporta: bajt-identičan izlaz bez CMS sekcija

## Status
COMPLETE

## Assertions covered
AS-038: PASS — non-CMS page export is byte-compatible; verified `hasCmsSections=false` with no other new keys on JSON export objects/envelope
AS-039: PASS — markdown export (`toMarkdown`) output is unchanged for pages without CMS sections; confirmed it never references section kind or hasCmsSections at all

## Files changed
tests/unit/sitemap-io.test.ts

## Commands run
`npx vitest run tests/unit/sitemap-io.test.ts --reporter=verbose` (0) — 29/29 passed
`npx vitest run tests/unit` (1, pre-existing failures unrelated to this feature — see Notes)
`git commit` (0)

## Decisions made
- The feature spec/clarification referenced `toCopyBriefMarkdown`, but no such function exists in `lib/architecture/sitemap-io.ts` — the actual markdown export function is `toMarkdown`. Used `toMarkdown` since it is the real markdown export sibling of `toJson`/`toCsv`/`toSitemapXml`, and AS-039's intent (markdown export unchanged for non-CMS pages) is fully covered by it.
- Verified byte-compatibility by asserting the exact key set of each JSON page object equals the pre-F009 shape (`path`, `title`, `kind`, `sections`) plus exactly one new key (`hasCmsSections`), rather than only checking the value — this catches any other accidental field additions.
- Also added a light guard test confirming `toCsv` and `toSitemapXml` (sibling non-JSON exports) never leak `hasCmsSections` into their output, since those exports are untouched by F009 by construction and should stay that way.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `toMarkdown` instead of the spec-mentioned `toCopyBriefMarkdown`, which does not exist in the codebase. `toMarkdown` is the real markdown export function and satisfies AS-039's intent (markdown export for the sitemap is unchanged for non-CMS pages).

## Notes for the next worker
Full `npx vitest run tests/unit` shows 8 failed test files / 29 failed tests, all pre-existing and unrelated to sitemap-io.ts or this feature: `f027-calendar-realtime-wiring.test.tsx`, `undo-toast.test.tsx`, `personal-todo-list-realtime-wiring.test.tsx`, `f039-portal-guards.test.ts`, `f022-board-realtime-guard-call-site.test.tsx`, `f251-list-table-realtime.test.tsx`, `f019-my-tasks-realtime-hook-set-identity.test.tsx`, `watching-feed-query.test.ts` (e.g. `TypeError: supabase.rpc is not a function`, realtime mock wiring issues). None touch `lib/architecture/sitemap-io.ts` or its tests. `tests/unit/sitemap-io.test.ts` itself is fully green (29/29).
