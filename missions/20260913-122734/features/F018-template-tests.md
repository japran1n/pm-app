# F018: Tests — seed-from-template and delete guard

**Milestone:** M4 — Templates UI
**Estimated worker time:** 30 minutes
**Depends on:** F012, F016

## Assertion IDs covered
- AS-066, AS-067

## Draft scope
- Test `createDocFromTemplate`: mock Supabase client, assert doc row created with correct fields, assert doc_links count = template links count, assert positions preserved
- Test `deleteDocTemplate` guard: caller is creator → allowed; caller is admin → allowed; caller is neither → throws/returns authorization error
- Use Vitest with Supabase mock pattern already in the test suite

## Files (approximate)
- `tests/unit/doc-templates-seed.test.ts`
- `tests/unit/doc-templates-delete-guard.test.ts`

## Notes for clarification
- MCP at run: none
