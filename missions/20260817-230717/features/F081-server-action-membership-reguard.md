# F081: server action membership reguard

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 30 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-143

## Draft scope
- Audit pass: every mutating Server Action re-checks workspace membership server-side before touching data, not solely relying on RLS

## Files (approximate)
lib/actions/*.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
