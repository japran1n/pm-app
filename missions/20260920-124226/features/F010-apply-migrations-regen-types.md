# F010: apply migrations regen types

**Milestone:** M2 — Database
**Estimated worker time:** 15 minutes
**Depends on:** F008,F009

## Assertion IDs covered
- AS-076: `npm run migrations:check` reports no drift against the remote database.

## Draft scope
- Apply both migrations with the project's own tooling.
- Regenerate the database types.
- migrations:check reports no drift.

## Files (approximate)
- `lib/supabase/database.types.ts`

## Notes for clarification
MCP at run: Supabase MCP for the post-apply schema read.
