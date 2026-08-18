# F148: parent/child task relation

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F145

## Assertion IDs covered
- AS-265: a task cannot be its own parent and cycles are rejected
- AS-266: nesting is limited to one level

## Draft scope
- Migration: `tasks.parent_task_id` uuid null referencing tasks(id), indexed; CHECK preventing self-reference; trigger or constraint rejecting a parent that itself has a parent.
- Parent and child must belong to the same project — enforced in the database, not only in the action.
- Integration test for both rejection paths.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- One level is a deliberate product limit; the constraint must state that in a comment so a future reader does not "fix" it.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F148-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - One level is a deliberate product limit; the constraint must state that in a comment so a future reader does not "fix" it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-265, AS-266) has a named test or a written verification note.
