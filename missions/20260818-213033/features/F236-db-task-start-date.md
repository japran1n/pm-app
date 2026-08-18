# F236: task start date

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F166

## Assertion IDs covered
- AS-453: a task can have a start date, which must not be after its due date

## Draft scope
- Migration: `tasks.start_date date null` with a CHECK that it is null or `<= due_date`.
- Zod validation with a field-level error message, plus a date-range input in the task detail sheet.
- Unit tests for the validation boundary, including a null due date with a set start date.

## Files (approximate)
supabase/migrations/ (new), lib/validation/tasks.ts, components/task/task-detail-sheet.tsx

## Notes for clarification
- Decide what a start date without a due date means for the timeline (F237) — probably a single-day bar.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F236-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Decide what a start date without a due date means for the timeline (F237) — probably a single-day bar.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-453) has a named test or a written verification note.
