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
