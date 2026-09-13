# F025: Tests — placeholder resolution

**Milestone:** M6 — Placeholders UI
**Estimated worker time:** 20 minutes
**Depends on:** F021

## Assertion IDs covered
- AS-064

## Draft scope
- Test `resolvePlaceholders` in 'client' mode: auto-resolved key with matching project_link → correct value; missing link → empty string; manual key with value → correct value; mixed → correct combination
- Test 'team' mode: unresolved key → `<mark data-unresolved="key">{{key}}</mark>`; resolved key → value, no mark
- Pure unit tests, mock the data fetching

## Files (approximate)
- `tests/unit/placeholder-resolution.test.ts`

## Notes for clarification
- MCP at run: none
