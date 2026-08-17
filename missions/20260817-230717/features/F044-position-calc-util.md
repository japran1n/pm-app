# F044: position calc util

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 30 minutes
**Depends on:** F043

## Assertion IDs covered
- AS-071
- AS-072
- AS-073
- AS-074
- AS-082

## Draft scope
- Pure function: fractional-index position calculation given prev/next neighbor positions, including column-boundary cases
- Unit tests covering the boundary and rapid-repeat cases

## Files (approximate)
lib/board/position.ts, tests/unit/position.test.ts

## Notes for clarification
This is the feature AS-150's Playwright test will exercise indirectly — get the pure math right and well-tested here first.
- MCP at run: none
