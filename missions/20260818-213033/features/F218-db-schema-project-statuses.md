# F218: project_statuses table + migration of the fixed four

**Milestone:** M16 — Views: custom statuses, swimlanes, saved views, my tasks, calendar, timeline
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-403: board columns are defined per project
- AS-407: a new project starts with the default four columns
- AS-408: existing tasks migrate with their status preserved exactly

## Draft scope
- Migration: `project_statuses` (id, project_id, name, color, category text check in ('not_started','in_progress','done'), position double precision, created_at) with project-visibility RLS.
- Seed the current four (todo, in_progress, in_review, done) for every existing project, mapped to categories; add `tasks.status_id` and backfill from `tasks.status`.
- Keep `tasks.status` in place, deprecated, until F223 finishes migrating readers.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/status-backfill.test.ts (new)

## Notes for clarification
- This is the highest-risk migration in the mission: every board, list, filter, RPC, and realtime path reads `status` today.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F218-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - This is the highest-risk migration in the mission: every board, list, filter, RPC, and realtime path reads `status` today.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-403, AS-407, AS-408) has a named test or a written verification note.
