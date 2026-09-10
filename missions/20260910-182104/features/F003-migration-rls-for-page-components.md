# F003: Migration — RLS for page_components

**Milestone:** M1 — Foundation: tokens and schema

**Est:** 45 min · **Depends on:** F002
**Covers:** AS-089, AS-090, AS-092, AS-093, AS-096, AS-097
- Team select via `is_project_visible_to`; client select via client + portal-enabled conjuncts
- Write restricted to `is_project_workspace_writer`
- Negative tests: client write, cross-project read, viewer write
**Files:** `supabase/migrations/<ts>_architecture_page_components_rls.sql`


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
