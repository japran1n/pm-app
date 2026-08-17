# F089: perf budget check

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 25 minutes
**Depends on:** F049

## Assertion IDs covered
- AS-156, AS-136

## Draft scope
- Measure p95 server response time for a project's board data fetch at v1-scale seed data; must be under 500ms locally/staging

## Files (approximate)
tests/unit or a small perf script

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
