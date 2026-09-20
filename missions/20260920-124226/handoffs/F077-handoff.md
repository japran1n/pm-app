# Handoff: F077 — Fix AS-013 — real storage guard via vi.stubGlobal + repo-wide scan

## Status
COMPLETE

## Assertions covered
AS-013: PASS — 15/15 tests pass in tests/unit/f029-switcher-url-wiring.test.tsx; mutation test (injecting `window.localStorage.setItem("planner:week", "x")` into people-switcher.tsx) correctly fails the source-scan test, confirming the guard is real.

## Files changed
tests/unit/f029-switcher-url-wiring.test.tsx
components/calendar/people-switcher.tsx

## Commands run
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0) — 15 passed
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` after mutation injection (1) — 5 failed as expected, confirming guard catches the mutation
`npx vitest run tests/unit` (1) — 41 files failed / 467 passed; all failures are pre-existing, unrelated to this feature (sections/boards/CMS-badge tests from other missions), verified by grepping FAIL output — none reference calendar/people-switcher/f029

## Decisions made
- Implemented the exact two-part guard from the spec: (1) source scan reading all 5 calendar files and asserting none matches `/localStorage|sessionStorage|indexedDB/i`, replacing the prior ineffective `vi.spyOn(Storage.prototype, "setItem")`-only test; (2) `vi.stubGlobal("localStorage", {...})` / `vi.stubGlobal("sessionStorage", {...})` runtime guard around rendering `PeopleSwitcherUrlBound` and toggling a member, asserting `setItem` mocks are never called, with `vi.unstubAllGlobals()` in a `finally` block to avoid leaking stubs into other tests.
- The source scan (case-insensitive, no word-boundary carve-out) matched two pre-existing doc comments in `components/calendar/people-switcher.tsx` that discussed the "no localStorage/sessionStorage" design decision in prose. Per the spec's literal regex (`/localStorage|sessionStorage|indexedDB/i`, no comment exemption), these comments made the test fail even though no code called the APIs. Reworded both comments to say "browser storage" instead of naming the specific APIs — preserves the same meaning/intent documentation without tripping the banned-token scan. This is the only change to people-switcher.tsx; no logic was touched.
- Kept the existing AS-011/AS-012/AS-059 describe blocks in the same file untouched — spec allowed either extending this file or adding a new one; extending in place kept AS-013 coverage adjacent to the other people-switcher URL-wiring assertions it's most related to.

## Out-of-scope work needed
None. Note (not a blocker for this feature): `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` had pre-existing uncommitted changes on disk from other in-flight work (F075's `buildPlannerNavHrefs` refactor) — left untouched, not part of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reworded two doc comments in people-switcher.tsx (removing the literal strings "localStorage"/"sessionStorage" in favor of "browser storage") because the spec's source-scan regex is case-insensitive with no comment exemption, and the spec's own example test snippet has no such exemption either. This is the minimal change that satisfies the literal spec while preserving the comments' documentation intent.

## Notes for the next worker
No MCP tools used — this is a pure test/source-comment change, no external services touched. The mutation test was verified manually by temporarily injecting a `window.localStorage.setItem(...)` call at the top of `people-switcher.tsx`, running the suite, observing the source-scan assertion fail, then restoring the original file from a backup copy before committing (confirmed via `git diff` that no mutation leaked into the commit).
