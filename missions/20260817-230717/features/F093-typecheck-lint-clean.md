# F093: typecheck lint clean

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 20 minutes
**Depends on:** F092

## Assertion IDs covered
- AS-157
- AS-158

## Draft scope
- Full repo passes `npx tsc --noEmit` with zero errors and `npx eslint .` with zero errors (warnings allowed)

## Files (approximate)
(repo-wide fixes, no new files expected)

## Notes for clarification
This is the final feature of the mission — run it last so it catches anything the audit passes (F079-F088) introduced.
- MCP at run: none
