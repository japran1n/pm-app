# Handoff: F067 — Fix AS-011 page.tsx URL integration test gap

## Status
COMPLETE

## Assertions covered
AS-011: PASS — added `tests/unit/f029-switcher-url-wiring.test.tsx` case "both buildWeekNavHref(...) calls in page.tsx include the peopleParam wiring", which reads `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` as source, extracts every `buildWeekNavHref({...})` call site via regex, and asserts each one contains `peopleParam`. Confirmed the mutation (removing `peopleParam` from both call sites) makes this new test fail while all other pre-existing tests stay green, then restored the real code and confirmed all 10 tests in the file pass.

## Files changed
tests/unit/f029-switcher-url-wiring.test.tsx

## Commands run
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0) — 10 passed, real code
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (1) — mutation applied (peopleParam removed from both call sites in page.tsx), 1 failed / 9 passed, confirming the new test is the one that catches it
`npx tsc --noEmit` (1) — fails, but the single error is in `components/calendar/people-switcher.tsx` (pre-existing local working-tree modification unrelated to this feature — `git diff` shows a `"hidden flex items-center..."` className edit already present before this worker started and untouched by this change; not something F067's scope covers)

## Decisions made
- Chose Option 1 (source-level grep) from the spec's two options — it required no Next.js render harness or new dependencies, matching the existing F029 file's established pattern of reading component source via `node:fs/promises` and asserting on it directly (see the adjacent "people-switcher source never CALLS localStorage/sessionStorage" test in the same file).
- Used a regex that captures each full `buildWeekNavHref({...})` call-site literal and asserts `peopleParam` appears within each captured call, rather than a single whole-file substring check — this ties the failure to a specific call site being wrong, not just "the string appears somewhere in the file," and was verified via the required mutation gate (delete `peopleParam` from both calls → new test fails; restore → passes).
- Added the test to the existing `tests/unit/f029-switcher-url-wiring.test.tsx` file (spec's first suggested location) rather than a new file, keeping all AS-011-related coverage co-located.

## Out-of-scope work needed
- `npx tsc --noEmit` currently fails due to a pre-existing uncommitted change in `components/calendar/people-switcher.tsx` (JSX `className` prop duplicated — `"hidden flex items-center..."` vs the `cn(...)` call producing a second `className`-shaped conflict per TS17001). This predates this worker's changes (confirmed via `git diff` before any edits were made) and is unrelated to AS-011/F067. Orchestrator should route this to a follow-up feature or confirm with whoever left that local edit whether it's intentional in-progress work.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the source-level regex-grep test (spec Option 1) over a full page render (Option 2) since the spec explicitly permits either and Option 1 avoids introducing a Next.js server-render test harness as a new dependency — consistent with the "no new dependencies" constraint in the spec.

## Notes for the next worker
The new test lives at the bottom of `tests/unit/f029-switcher-url-wiring.test.tsx`. It greps for the literal pattern `buildWeekNavHref({...})` (single-line object literal, no nested braces) — if page.tsx's call-site formatting ever changes to a multi-line/nested-object form, the regex `[^}]*` would need updating to handle nested braces. No MCP tools were needed for this feature — it is a pure local test-file addition.
