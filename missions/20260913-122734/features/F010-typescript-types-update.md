# F010: Regenerate TypeScript database types

**Milestone:** M3 — Templates DB
**Estimated worker time:** 10 minutes
**Depends on:** F007, F008, F009

## Assertion IDs covered
- (enabler — no direct assertion, but blocks all subsequent TS work)

## Draft scope
- Run `supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`
- Verify new types for `doc_templates` and `doc_template_links` appear
- Fix any resulting TS errors (typically zero for additive migrations)

## Files (approximate)
- `lib/supabase/database.types.ts`

## Notes for clarification
- MCP at run: Supabase MCP (generate_typescript_types)
