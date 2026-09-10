# F002: Migration — page_components table and two task columns

**Milestone:** M1 — Foundation: tokens and schema

**Est:** 45 min · **Depends on:** F001
**Covers:** AS-009, AS-010, AS-011, AS-012, AS-062, AS-063, AS-065, AS-066
- `page_components(id, project_id, name, description, position, created_at, updated_at)`
- `unique (project_id, lower(name))`, name-not-empty check
- `tasks.page_kind text` check in (static, cms, utility); `tasks.component_id uuid` FK on delete set null
- Indexes on `page_components(project_id, position)` and `tasks(component_id)`
- No `parent_page_id` — hierarchy lives in the slug only (round-2 follow-up 3)
**Files:** `supabase/migrations/<ts>_architecture_page_components.sql`


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
