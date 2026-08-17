# F084: parameterized queries audit

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 15 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-147

## Draft scope
- Audit pass: no raw string-concatenated SQL anywhere; all queries go through the Supabase client's parameterized query builder or a parameterized RPC call

## Files (approximate)
lib/actions/*.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
