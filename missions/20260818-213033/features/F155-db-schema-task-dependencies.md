# F155: task_dependencies table + RLS

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-276: a task can be marked blocked by another task in the same workspace
- AS-279: a task cannot depend on itself
- AS-284: deleting a task leaves no dangling dependency rows
- AS-285: cross-workspace dependencies are rejected at the database

## Draft scope
- Migration: `task_dependencies` (id, blocking_task_id, blocked_task_id, created_by, created_at; unique pair; CHECK blocking <> blocked), FKs with `on delete cascade`.
- A trigger or policy asserting both tasks resolve to the same workspace.
- RLS through the same project-visibility helper; integration test for the cross-workspace rejection.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/rls-dependencies.test.ts (new)

## Notes for clarification
- Only one relation type (blocks/blocked-by) is in scope; "relates to" and "duplicates" are not.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F155-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Only one relation type (blocks/blocked-by) is in scope; "relates to" and "duplicates" are not.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-276, AS-279, AS-284, AS-285) has a named test or a written verification note.
