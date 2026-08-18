# F145: project keys and per-project task numbers

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-257: every project has a short key, unique within its workspace
- AS-259: numbers are assigned atomically, never duplicated under concurrency
- AS-260: numbers are never reused after deletion
- AS-261: pre-existing tasks receive keys retroactively in creation order

## Draft scope
- Migration: `projects.key` text (uppercase, 2–6 chars, unique per workspace) auto-derived from the project name on creation, editable; `projects.task_counter` integer; `tasks.number` integer with a unique (project_id, number) index.
- Assignment inside the insert path via an atomic counter increment in a database function — not a `max(number)+1` read-then-write.
- Backfill: keys for existing projects, numbers for existing tasks ordered by `created_at`.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- Key collision on backfill (two projects named "Marketing") needs a deterministic disambiguation rule.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F145-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Key collision on backfill (two projects named "Marketing") needs a deterministic disambiguation rule.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-257, AS-259, AS-260, AS-261) has a named test or a written verification note.
