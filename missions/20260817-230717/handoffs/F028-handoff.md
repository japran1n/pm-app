# Handoff: F028 — edit project action

## Status
COMPLETE

## Assertions covered
AS-029: PASS — `editProject` in `lib/actions/projects.ts`; any active workspace member can edit name/description/start_date/end_date (tested with a member who is not the project's creator). Integration test: `tests/integration/edit-project.test.ts`.
AS-037: PASS — `updated_at` is stamped automatically by the pre-existing `projects_set_updated_at` trigger (`set_updated_at()`, `supabase/migrations/20260818004413_create_projects.sql`), never set from app code. Confirmed the trigger fires: test asserts the DB row's `updated_at` strictly increases after an edit.

## Files changed
lib/actions/projects.ts
lib/validation/projects.ts
components/edit-project-dialog.tsx
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/integration/edit-project.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/projects.ts lib/validation/projects.ts components/edit-project-dialog.tsx "app/(workspace)/w/[workspaceSlug]/projects/page.tsx" tests/integration/edit-project.test.ts` (0)
`npm run build` (0)
`npx vitest run` (0) — 25 files, 134 tests passed (includes the 4 new F028 tests)

## Decisions made
- Reused/extended `lib/validation/projects.ts` with a new `editProjectSchema`: same per-field constraints as `createProjectSchema` but every field optional (partial update), since `editProject` supports editing any subset of name/description/startDate/endDate. `workspaceId`/`projectId` are passed as separate function args (not part of the Zod-validated updates object), matching the feature spec's function signature.
- Did **not** set `updated_at` from application code. Confirmed via reading `supabase/migrations/20260818004413_create_projects.sql` that `projects_set_updated_at` (before-update trigger calling `set_updated_at()`) already stamps `now()` on every update — this is the sole source of truth for AS-037, verified directly against the DB in the test (not just against the Server Action's return value).
- `editProject` fetches the existing row (scoped to `id` + `workspace_id` + `deleted_at is null`) before validating the start/end date ordering, so a **partial** update (e.g. only `endDate` supplied) is checked against the *effective* date (existing DB value merged with the new one) rather than only the fields present in this call — otherwise a partial update could silently create an invalid start/end combination that the create-time Zod refine alone wouldn't catch. This also double-scopes the update to the caller's workspace, so a projectId belonging to a different workspace than `workspaceId` cannot be edited even if the caller is an active member of `workspaceId`.
- Followed the exact `createProject` pattern for membership re-check (`requireActiveMembership`, defense in depth per AS-143), discriminated-union return, admin client for the actual write, generic user-facing errors with `console.error` detail logging, and `revalidatePath(/w/<slug>, "layout")` wrapped in try/catch (non-fatal in test/no-request-context environments, same rationale as the sibling action).
- Followed the clarified spec's "no per-task[/project] ownership restriction" convention (AS-061's principle applied to projects, since AS-029 does not restrict editing to the creator or to admin/owner, unlike AS-030's archive action which the plan separately role-gates).
- Added the edit affordance directly to the F027 project list page's card (an icon button opening a Dialog, pre-filled with the current values) rather than a project detail page, since F030 (project detail page) doesn't exist yet — matches this feature's own scope note.

## Out-of-scope work needed
- F030 (project detail page) will likely want its own edit entry point too — the `EditProjectDialog` component is written to accept `workspaceId` + a `project` prop shape, so it can be reused as-is from a detail page later without changes.
- AS-030/AS-033 (archive/soft-delete a project, role-gated to admin/owner) is a separate assertion pair and out of scope here — not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: When an edit call's `updates` object has zero fields with defined values (a caller passes nothing to change), `editProject` returns `{ ok: false, error: "No changes to save." }` instead of performing a no-op DB write. This wasn't explicitly specified by AS-029/AS-037 or the clarified spec, but avoids an unnecessary trigger-fired `updated_at` bump for a call that changed nothing.

## Notes for the next worker
- The date-ordering re-check inside `editProject` (comparing the *effective* start/end after merging with the existing row) is the one piece of logic beyond a straight copy of `createProject`'s pattern — worth re-reading if AS-035 semantics ever get their own dedicated assertion for edits specifically.
- `tests/integration/edit-project.test.ts` follows the exact `loadDotEnv`/`vi.mock`/`describe.skipIf(!haveAdminCreds)` scaffolding from `tests/integration/create-project.test.ts` — copy that file's header again for any future project-mutation test rather than re-deriving it.
- No MCP tools used at run (registry says none for this feature).
