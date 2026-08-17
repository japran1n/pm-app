# F083: sanitization audit

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 15 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-148

## Draft scope
- Audit pass: task titles/descriptions/comments render as text, never via dangerouslySetInnerHTML or equivalent

## Files (approximate)
components/task/*, components/board/*

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
