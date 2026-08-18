# F126: expand the workspace role set

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 30 minutes
**Depends on:** F120

## Assertion IDs covered
- AS-215: a member holds one of owner, admin, member, or viewer
- AS-238: an invite specifies the role granted on acceptance

## Draft scope
- Migration: widen the `workspace_members.role` CHECK constraint to owner/admin/member/viewer/guest; add `invited_role` to the invite path so acceptance grants the intended role.
- Keep existing rows untouched — every current member stays exactly what they are.
- Update the sole-owner guard function so it counts owners under the new constraint without regressing AS-018.
- Regenerate database types.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, lib/validation/invites.ts, lib/actions/invites.ts

## Notes for clarification
- `guest` is a role value here but its scoping rules land in F134; this task only widens the domain.
- MCP at run: Supabase MCP for the migration.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F126-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - `guest` is a role value here but its scoping rules land in F134; this task only widens the domain.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-215, AS-238) has a named test or a written verification note.
