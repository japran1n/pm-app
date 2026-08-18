# Handoff: F026 — create project action

## Status
COMPLETE

## Assertions covered
AS-025: PASS — integration test "an active member can create a project; created_at/created_by are set correctly" (tests/integration/create-project.test.ts)
AS-026: PASS — unit tests reject empty/whitespace-only name (tests/unit/create-project-schema.test.ts); integration test confirms the Server Action rejects an empty name before any insert (tests/integration/create-project.test.ts)
AS-035: PASS — unit tests cover accept/reject combinations of start/end date (tests/unit/create-project-schema.test.ts); integration test confirms the Zod pre-check rejects end < start via the Server Action, AND a separate test confirms the DB CHECK constraint `projects_end_date_after_start_date` independently rejects it via a direct admin-client insert that bypasses Zod (tests/integration/create-project.test.ts)
AS-036: PASS — integration tests assert `created_at`/`created_by` are set on the returned data and verified against the DB row, attributed to the correct caller across sequential creates (tests/integration/create-project.test.ts)

## Files changed
lib/actions/projects.ts
lib/validation/projects.ts
tests/unit/create-project-schema.test.ts
tests/integration/create-project.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/projects.ts lib/validation/projects.ts tests/unit/create-project-schema.test.ts tests/integration/create-project.test.ts` (0)
`npm run lint` (0)
`npm run build` (0)
`npm run test` (0) — 23 test files, 126 tests passed, including the new unit and integration suites for this feature (run against the real linked Supabase project via `.env`)

## Decisions made
- Followed lib/actions/workspaces.ts pattern exactly: `"use server"` file, Zod schema in lib/validation/projects.ts, discriminated-union `CreateProjectResult`, membership re-verified server-side via the shared `requireActiveMembership` helper from lib/auth/require-membership.ts (any active member may create — AS-025 does not restrict by role, unlike some workspace actions that use `requireWorkspaceAdmin`/`requireWorkspaceOwner`).
- Used the admin client for the actual insert (consistent with every other action in lib/actions/workspaces.ts), but only after the membership check already passed independently — the RLS policy `projects_insert_active_members` (F025) would also permit this same insert for a plain session client, so this is not an RLS bypass, just consistency with the established file's style.
- `startDate`/`endDate` are validated as plain `YYYY-MM-DD` strings (regex-checked) rather than parsed into `Date` objects, to avoid timezone/off-by-one mismatches against the DB's `date` columns — string comparison (`endDate >= startDate`) is safe and correct for this fixed format.
- Zod's `.refine` on the whole object (not per-field) implements AS-035's cross-field constraint, mirroring the DB CHECK constraint's own `end_date is null or start_date is null or end_date >= start_date` logic exactly (both sides treat "either side missing" as valid).
- Added a dedicated integration test that inserts directly via the admin client (bypassing Zod entirely) to independently prove the DB CHECK constraint itself still rejects an invalid date range — per AS-035's "the database rejects it server-side" clause and the task's explicit instruction to test the DB invariant, not just the UI-adjacent Zod path.

## Out-of-scope work needed
- No project-listing UI/page exists yet (F027, AS-027/AS-042) — `revalidatePath` here targets `/w/[slug]` (layout) as a best-effort placeholder since there's no dedicated `/projects` route to target yet; a future project-list feature should confirm/adjust this revalidation target once that route exists.
- No create-project form/UI component exists yet — this feature is the Server Action + validation only, per its stated file scope (`lib/actions/projects.ts`, `lib/validation/projects.ts`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `requireActiveMembership` (not `requireWorkspaceAdmin`/`requireWorkspaceOwner`) for the server-side re-check, since AS-025 says "a workspace member can create a project" with no role restriction — mirrors the clarified spec's Round A Q9 option (a): "any workspace member."
AUTONOMOUS_DECISION: Revalidation target chosen as `/w/[slug]` (layout) rather than a specific `/projects` path, since no project-list route exists yet in this codebase (confirmed via `find app -iname "*project*"` returning no results) — this is a placeholder scoped narrowly enough to not need a follow-up feature to fix, just a note for whichever future feature adds the project-list page.

## Notes for the next worker
- `lib/validation/projects.ts`'s `createProjectSchema` is a `z.object(...).refine(...)` — its inferred type `CreateProjectInput` is exported for reuse if a create-project form (future feature) wants the same shape client-side.
- Test fixtures needed valid RFC-format UUIDs for `workspaceId` in the unit test (zod v4's `.uuid()` validates the version/variant nibbles strictly) — `11111111-1111-4111-8111-111111111111` used as the well-formed fixture; a naive all-`1`s UUID like workspaces.ts-adjacent tests sometimes use will fail zod v4's stricter check.
- The integration test suite creates and cleans up its own throwaway workspace, users, and projects (afterAll teardown) — no manual DB cleanup needed.
