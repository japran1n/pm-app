# F082: zod schemas all actions

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 25 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-146
- AS-160

## Draft scope
- Audit pass: every Server Action validates input via Zod before any database call; no `any` types on exported function signatures

## Files (approximate)
lib/validation/*.ts, lib/actions/*.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
