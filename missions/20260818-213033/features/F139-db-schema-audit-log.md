# F139: audit_log table + append-only RLS

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 45 minutes
**Depends on:** F127

## Assertion IDs covered
- AS-247: a regular member's direct query for audit rows is rejected
- AS-249: entries are append-only — no update or delete path exists

## Draft scope
- Migration: `audit_log` (id, workspace_id, actor_id, action text, target_type text, target_id uuid, metadata jsonb, created_at) with indexes on (workspace_id, created_at desc) and actor_id.
- RLS: SELECT for owners/admins of the workspace only; INSERT via a security-definer function used by server code; no UPDATE or DELETE policy at all.
- RLS integration test proving a member reads zero rows and cannot delete an entry.

## Files (approximate)
supabase/migrations/ (new), tests/integration/rls-audit-log.test.ts (new)

## Notes for clarification
- `action` is a free-form string vs an enum — an enum forces a migration per new action type; prefer a documented naming convention (`project.archived`, `member.role_changed`).
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F139-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - `action` is a free-form string vs an enum — an enum forces a migration per new action type; prefer a documented naming convention (`project.archived`, `member.role_changed`).

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-247, AS-249) has a named test or a written verification note.
