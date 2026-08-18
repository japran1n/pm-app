# F227: saved_views table + RLS

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-426: filters, sort, and grouping can be saved as a named view
- AS-427: a view is personal or shared
- AS-434: a personal view is invisible to others, including via direct query

## Draft scope
- Migration: `saved_views` (id, workspace_id, project_id nullable, owner_id, name, scope text check in ('personal','shared'), config jsonb, is_default boolean, created_at).
- RLS: personal views readable only by their owner; shared views readable by anyone who can see the project.
- Config is validated by a Zod schema shared with the client so a malformed view cannot be stored.

## Files (approximate)
supabase/migrations/ (new), lib/validation/views.ts (new), tests/integration/rls-saved-views.test.ts (new)

## Notes for clarification
- Config shape must cover filters, sort, grouping, and view type (board/list/calendar/timeline) from the start.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F227-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Config shape must cover filters, sort, grouping, and view type (board/list/calendar/timeline) from the start.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-426, AS-427, AS-434) has a named test or a written verification note.
