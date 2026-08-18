# F100: project name check constraint

**Milestone:** M3 — Projects (follow-up)
**Estimated worker time:** 15 minutes
**Depends on:** F024
**Parent:** F024

## Assertion IDs covered
- AS-026

## Draft scope
- scrutiny-validator (M3-scrutiny.md) found the projects table has only `name text not null` — no CHECK constraint rejecting an empty string. The migration's own comment falsely claims the database rejects an empty name server-side; only client-side Zod actually blocks it. A direct/bypassed insert with name='' would succeed.
- Fix: add a migration with `ALTER TABLE projects ADD CONSTRAINT projects_name_not_empty CHECK (btrim(name) <> '')` (or equivalent), matching the same DB-level validation rigor already used for status/priority CHECK constraints elsewhere in the schema.
- Add a test proving a direct insert bypassing Zod (e.g. via the admin client) with an empty/whitespace-only name is rejected by the database.
- Correct the false comment in the original migration file is not possible (migrations are immutable once applied) — instead, add a clarifying comment in the NEW migration noting this closes the gap the original comment incorrectly claimed was already closed.

## Files (approximate)
supabase/migrations/ (new), tests/integration/create-project.test.ts or similar

## Notes for clarification
Source: M3-scrutiny.md, AS-026 row. Severity: major.
