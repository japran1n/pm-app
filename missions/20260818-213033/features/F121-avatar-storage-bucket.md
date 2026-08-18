# F121: avatar upload to Supabase Storage

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 45 minutes
**Depends on:** F120

## Assertion IDs covered
- AS-203: uploading an avatar replaces the initials avatar app-wide
- AS-205: an oversized upload is rejected with a message naming the limit
- AS-206: a non-image upload is rejected

## Draft scope
- Storage bucket for avatars with policies mirroring the existing attachments bucket pattern (own-file write, readable to shared-workspace members).
- `lib/actions/profile.ts` upload action: Zod-validated file size and MIME type, writes `profiles.avatar_url`, replaces the previous object rather than accumulating orphans.
- Size/type limits declared once in `lib/validation/profile.ts` and used by both the client input and the server check.

## Files (approximate)
supabase/migrations/ (new), lib/actions/profile.ts, lib/validation/profile.ts

## Notes for clarification
- Decide public bucket vs signed URLs; attachments already use private+signed, avatars are lower-risk and are rendered on every card, so a public bucket with unguessable paths may be the better trade.
- MCP at run: Supabase MCP for bucket + policy creation.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F121-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Decide public bucket vs signed URLs; attachments already use private+signed, avatars are lower-risk and are rendered on every card, so a public bucket with unguessable paths may be the better trade.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-203, AS-205, AS-206) has a named test or a written verification note.
