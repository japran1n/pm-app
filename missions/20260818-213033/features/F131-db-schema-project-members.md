# F131: project_members table + RLS

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F126

## Assertion IDs covered
- AS-224: a project has an explicit member list; adding a member grants access

## Draft scope
- Migration: `project_members` (project_id FK, user_id FK, project_role text check in ('lead','member'), added_by uuid, created_at; unique on (project_id, user_id)).
- RLS scoped through the project's workspace membership; only workspace owners/admins and project leads can insert or delete rows.
- Indexes on project_id and user_id; regenerate types.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- This table is the join every later project-scoped policy uses — get the helper SQL function right here (`is_project_visible_to(uid, project_id)`).
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F131-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - This table is the join every later project-scoped policy uses — get the helper SQL function right here (`is_project_visible_to(uid, project_id)`).

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-224) has a named test or a written verification note.
