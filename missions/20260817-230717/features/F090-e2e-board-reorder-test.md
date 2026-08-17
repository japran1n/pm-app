# F090: e2e board reorder test

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 30 minutes
**Depends on:** F048

## Assertion IDs covered
- AS-150

## Draft scope
- Playwright test: drag a card to a new position, reload the page, assert the persisted order matches

## Files (approximate)
tests/e2e/board-reorder.spec.ts

## Notes for clarification
MCP at run: Playwright MCP for authoring/running the test interactively if useful; the committed test itself runs via the Playwright CLI/test runner, not the MCP.
- MCP at run: Playwright MCP available for interactive authoring


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Tooling:** Playwright for e2e, Vitest for unit — exact commands from tech-decisions.md's "How to run tests".
- **Fixtures:** small seeded fixture created/torn down within the test itself, or extending `supabase/seed.sql`; never shared mutable global state, never production data.
- **Target:** the test's name references the exact assertion ID(s) from "Assertion IDs covered" above, per worker.md's `test_AS_NNN_...` convention.
- **Flakiness:** a flaky test is investigated and fixed as part of this feature, not deleted or ignored — not acceptable evidence at a milestone boundary.
- **Realtime timing:** where relevant, uses explicit wait-for-condition polling, never a fixed sleep.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
