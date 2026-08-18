# F175: recurrence rule storage

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F145

## Assertion IDs covered
- AS-314: daily, weekly, monthly, or every-N-days rules
- AS-323: a rule with an end date stops generating after it

## Draft scope
- Migration: `tasks.recurrence jsonb` (`{ freq, interval, until }`), `tasks.recurrence_parent_id` linking generated occurrences to their source, `tasks.last_occurrence_at`.
- CHECK/validation that interval is positive and freq is one of the supported values.
- Index for the scheduled job's lookup (`recurrence is not null and deleted_at is null`).

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- Full RFC 5545 RRULE is out of scope; the four rule shapes above are the contract.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F175-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Full RFC 5545 RRULE is out of scope; the four rule shapes above are the contract.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-314, AS-323) has a named test or a written verification note.
