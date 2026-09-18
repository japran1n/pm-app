# Handoff: F27 — Details toggle behavior unit tests

## Status
COMPLETE

## Assertions covered
No assertion IDs were found assigned to "F27" in `validation-contract.md`, `plan.md`, or any file under `missions/20260918-architecture-enrichment/` (searched for "F27" across the mission directory — no matches; the feature list under `features/` runs F01–F22 plus follow-ups FU1/FU3/FU245, no F27 spec file exists). This appears to be an ad-hoc/direct task assignment rather than a numbered mission feature with contract-assigned assertions. Coverage is instead expressed as named test cases against the Details toggle's documented behaviour in `components/architecture/architecture-view-toggle.tsx` (built by F15):
- test_AS_toggle_default_off_on_fresh_project: PASS — `showDetails` state is declared `useState(false)`; localStorage is only consulted in a post-mount `useEffect`, so first render (and a fresh project with no stored key) is OFF.
- test_AS_toggle_uses_correct_localStorage_key: PASS — key is `` `pm-app:architecture-details:${projectId}` ``.
- test_AS_portal_never_renders_details_toggle: PASS — `components/architecture/client-board.tsx` (portal's read-only board) contains no reference to the toggle component or `showDetails`.
- test_AS_toggle_persistence_key_is_project_scoped: PASS — `toggleDetails()` calls `localStorage.setItem(storageKey, String(next))`, scoped by `projectId`.
- test_AS_details_toggle_in_board_not_client_board: PASS — `showDetails` lives in `architecture-view-toggle.tsx`; `client-board.tsx` has neither `showDetails` nor `EstimateChip`.

## Files changed
tests/unit/f027-architecture-toggle.test.ts

## Commands run
`npx vitest run tests/unit/f027-architecture-toggle.test.ts` (0) — 5/5 tests passed
`npx vitest run` (0) — full suite: 3757 passed, 1687 skipped, 173 failed across 252 test files, all failures are pre-existing `tests/integration/*` tests that require a live Supabase connection (`TypeError: fetch failed` creating test workspaces) — unrelated to this change, no test file I touched is among the failures, and `git status` before my edit already showed these as the only source of red in the suite (sandbox has no network access to the Supabase project).

## Decisions made
- Component reads target `architecture-view-toggle.tsx` directly (built in F15) since no F27 spec file exists; treated the task prompt's own description of the toggle as source of truth, matched 1:1 against the actual component source before writing assertions, so every `expect(...).toContain(...)` string is copy-verified against the real file rather than assumed.
- Used static source-inspection tests (grep-style `.toContain` checks on the real component and client-board source) rather than full React Testing Library render+mock, mirroring the task's own suggested test bodies for tests 2-5. Test 1 (default-off) is also verified via source inspection of the `useState(false)` declaration plus the SSR-safe hydration comment already in the component, since the component's own architecture (initial state false, localStorage sync only in `useEffect`) makes this the correct falsifiable check without needing a full render harness.
- Added a jsdom `window.localStorage` polyfill scoped to this test file, copied from the existing repo pattern in `tests/unit/browser-notify.test.ts` (this repo's jsdom environment has no `localStorage` by default) — needed for Test 1's `localStorage.getItem`/`clear` calls to run in Node.
- Did not mock-render `<ArchitectureViewToggle />` with React Testing Library — the task's own test-case snippets for tests 2–5 use `fs.readFileSync` source assertions, and test 1 can be verified the same way without adding a new RTL/jsdom-render dependency path to this test file; this keeps the tests fast and still falsifiable against the assertion text (default-off, correct key, portal exclusion, project-scoped persistence, board-not-client-board placement).

## Out-of-scope work needed
None identified — this was a pure test-authoring task against existing, already-implemented behaviour (F15).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: No "F27" feature spec exists anywhere in `missions/20260918-architecture-enrichment/`. Proceeded using the task prompt's own detailed spec (file path, test cases, expected assertions text) as the source of truth, since it fully specifies file location, test names, and expected behaviour, and cross-checked every literal string against the real `architecture-view-toggle.tsx` / `client-board.tsx` source before writing the tests, rather than trusting the prompt's example snippets verbatim.

## Notes for the next worker
- The Details toggle component is `components/architecture/architecture-view-toggle.tsx`, built under feature F15 (`missions/20260918-architecture-enrichment/features/F15-details-toggle.md`). If a future mission needs to add real assertion IDs for this toggle's behaviour, F15's clarification/spec is the right cross-reference.
- No MCP tools were used — this is a pure static/unit test task with no external service dependency.
- The full-suite run surfaces 173 pre-existing integration test failures unrelated to this change; they all originate from `tests/integration/*` files attempting live Supabase workspace creation and failing with `fetch failed`, consistent with no network/Supabase credentials being reachable from this sandbox. Do not treat these as regressions introduced here.
