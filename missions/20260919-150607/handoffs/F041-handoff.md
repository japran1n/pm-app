# Handoff: F041 — changePageSlugSchema

## Status
COMPLETE

## Assertions covered
AS-139: PASS — schema parses valid inputs (uuid taskId, "my-page", "services/seo" nested slug)
AS-140: PASS — schema rejects empty slug, slug > 200 chars, uppercase, spaces, invalid taskId; accepts boundary of exactly 200 chars
AS-141: UNTESTED — uniqueness is a server-side DB check that belongs to the changePageSlug action (F042); schema-level test cannot exercise it. Added a TODO comment in lib/actions/architecture/pages.ts documenting the contract for the F042 worker.

## Files changed
lib/validation/architecture.ts
lib/actions/architecture/pages.ts
tests/unit/m7-change-page-slug-schema.test.ts

## Commands run
`npx vitest run tests/unit/m7-change-page-slug-schema.test.ts --reporter=verbose` (0, 8/8 passed)
`npx tsc --noEmit` (0, no output)

## Decisions made
- Reused the existing `slugPattern` regex (line 21 of architecture.ts) rather than duplicating it, matching the file's own "Enumi se ne pišu dvaput" (don't rewrite enums/patterns twice) convention noted elsewhere in the file.
- Did not add `.trim()` to the slug field (unlike createPageSchema's slug), matching the exact spec provided in the feature file verbatim.
- Added a TODO comment block at the end of lib/actions/architecture/pages.ts (not a full stub function) documenting the AS-141 uniqueness contract for F042, since F041's scope is schema-only and pages.ts's changePageSlug action does not exist yet.

## Out-of-scope work needed
- F042: implement the `changePageSlug` server action itself (membership/permission checks, DB update, AS-141 uniqueness enforcement against sibling pages in the same project).
- F043 (or F042): test coverage for AS-141's actual uniqueness behavior once the action exists.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For AS-141, per the spec's own instruction ("the actual test for AS-141 can be in F043... write a TODO comment... noting that uniqueness is tested in F042/F043"), I added the TODO as a code comment in lib/actions/architecture/pages.ts rather than only in this handoff, so the next worker sees it directly in the file they'll be editing.

## Notes for the next worker
No MCP usage required — this is a pure Zod schema + unit test feature, no live external state involved. F042's worker should read the TODO comment at the bottom of lib/actions/architecture/pages.ts before implementing the action.
