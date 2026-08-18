# F120: profiles table + RLS

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 45 minutes
**Depends on:** F118

## Assertion IDs covered
- AS-201: a profile row is created automatically on first sign-in
- AS-208: a user cannot edit another user's profile, including via direct API
- AS-209: profiles are visible to members of shared workspaces
- AS-210: a user with no shared workspace cannot read another profile

## Draft scope
- Migration: `profiles` (id uuid PK references auth.users, display_name text, avatar_url text, color text, timezone text default 'UTC', created_at, updated_at via the existing set_updated_at trigger).
- Trigger on `auth.users` insert to create the profile row automatically; backfill rows for users that already exist.
- RLS: SELECT allowed when the target user shares at least one workspace with `auth.uid()`, or is the caller; UPDATE only where `id = auth.uid()`; no client-side INSERT/DELETE.
- Regenerate `lib/supabase/database.types.ts`.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- The shared-workspace visibility predicate is reused by mentions (F203) and members lists — put it in a SQL helper function, not copy-pasted into each policy.
- MCP at run: Supabase MCP for applying the migration and verifying RLS.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F120-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The shared-workspace visibility predicate is reused by mentions (F203) and members lists — put it in a SQL helper function, not copy-pasted into each policy.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-201, AS-208, AS-209, AS-210) has a named test or a written verification note.
