# F080: env secrets audit

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- AS-140
- AS-141
- AS-142

## Draft scope
- .gitignore covers .env* except .env.example; git history has no committed secret; .env.example lists every key with no real values

## Files (approximate)
.gitignore, .env.example

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
