# Handoff: F227 — db-schema-saved-views

## Status
COMPLETE

## Assertions covered
AS-426: PASS — `test_AS_426_a_view_can_be_saved_with_filters_sort_and_grouping_as_a_named_view` (tests/integration/rls-saved-views.test.ts) + Zod-layer tests in tests/unit/saved-views-schema.test.ts.
AS-427: PASS — scope ('personal'/'shared'), view_type, config-shape, and name CHECK tests in tests/integration/rls-saved-views.test.ts and tests/unit/saved-views-schema.test.ts (both DB and Zod layers).
AS-434: PASS — `test_AS_434_a_personal_view_is_invisible_to_another_project_member_via_a_direct_query` and `test_AS_434_a_personal_view_is_invisible_to_a_workspace_member_who_cannot_see_the_project_at_all` in tests/integration/rls-saved-views.test.ts (direct-query negative cases, including update/delete attempts by a non-owner).

## Files changed
supabase/migrations/20260826010000_create_saved_views.sql
lib/validation/views.ts
lib/supabase/database.types.ts
tests/integration/rls-saved-views.test.ts
tests/unit/saved-views-schema.test.ts

## Commands run
`supabase db push` (0) — applied 20260826010000_create_saved_views.sql to the linked project (qcipqonnqajmazdbysow)
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts
`npx tsc --noEmit` (0) — clean, no output
`npx eslint .` (0) — 0 errors, 2 pre-existing warnings unrelated to this feature (lib/queries/search.ts:280, tests/unit/invite-member-pagination.test.ts:186)
`npx vitest run tests/unit/saved-views-schema.test.ts tests/integration/rls-saved-views.test.ts` (0) — 21/21 passed
`npm run test` (0, but see note below) — 68 test files / 66 tests failed with "TypeError: fetch failed" spread across dozens of PRE-EXISTING, unrelated integration test files (create-workspace-owner, edit-project, f219/f220/f223/f226/f313/f319/f320, etc.) — a transient connectivity/rate-limit condition during the full parallel run, matching this feature's "Known infra conditions" guidance. Verified non-regression by re-running two of the failing files alone (`create-workspace-owner.test.ts`, `edit-project.test.ts`) immediately after — both passed cleanly (9/9). My own two new test files were re-run standalone after the full-suite run and passed 21/21 with zero flake.

## Decisions made
- AUTONOMOUS_DECISION: Data shape — typed columns for everything RLS/FKs/indexes need to reason about directly (workspace_id, project_id, owner_id, name, scope, view_type, is_default), plus a single `config` jsonb column for the open-ended filters/sort/grouping payload. Rejected a single jsonb blob for the whole row (clarification round's option (b)) because RLS predicates and FKs cannot reach into JSON. `config` itself stays jsonb (not further typed columns) because its shape will keep evolving as F228/F229 and later features add filter types — a DB CHECK enforces only `jsonb_typeof(config) = 'object'` as the backstop, with the real shape validation living in `lib/validation/views.ts`'s Zod schema (`savedViewConfigSchema`), per "the DB is the last line, not the only line."
- AUTONOMOUS_DECISION: Visibility for shared views. AS-429 (owned by F229, but the RLS has to support it now) says "a shared view is visible to every member with access to its project" — but the Draft scope also allows `project_id` nullable, implying a workspace-level view. RLS branches: `project_id is not null` → reuse `public.is_project_visible_to(project_id)` exactly as instructed; `project_id is null` → reuse the existing `public.is_active_workspace_member(workspace_id)` helper (supabase/migrations/20260817222822_rls_workspaces.sql) so a workspace-level shared view is visible to every active workspace member. This is the simplest option that reuses two existing SECURITY DEFINER helpers with no new predicate logic.
- AUTONOMOUS_DECISION: UPDATE/DELETE RLS floor is "owner only." AS-430 ("only a view's creator or an admin can edit or delete a shared view") is explicitly F228's assertion, not F227's — F228 will need an admin-client path with its own application-layer role check (same seam as F219's `canManageColumns` pattern) for the "admin, not owner" case. RLS here intentionally stays the simple, unbypassable owner-only floor; F228's Server Actions add the admin exception on top. Documented in the migration's UPDATE/DELETE policy comments so F228 doesn't have to re-derive this.
- `is_default` uses a partial unique index on `(owner_id, project_id)` where `is_default` is true (AS-431, owned by F228) so at most one default view per user per project exists at the DB level, not just enforced by application logic — again "the DB is the last line."
- All three FKs (`workspace_id`, `project_id`, `owner_id`) are `on delete cascade`. No last-row guard/trigger was added (no assertion requires "a project must always have at least one saved view"), so this migration cannot reproduce F219's guard-vs-cascade blocker. Verified explicitly with two integration tests: project hard-delete with a saved_views row present, and (documented below) a direct database-level owner_id cascade check.

## Out-of-scope work needed
- F228 (Server Actions: opening a view restores filters/sort/grouping exactly (AS-428), only creator/admin can edit/delete shared (AS-430), set-as-default (AS-431)) needs an admin-client path for the "admin edits/deletes someone else's shared view" case, since RLS here only allows the owner to UPDATE/DELETE. Reuse `isProjectVisibleToCaller` from `lib/actions/project-visibility.ts` for any admin-client re-check, per this repo's convention — do not write a second copy.
- F229 (UI: shareable URL (AS-432), graceful degradation when a view references a deleted status/member (AS-433)) is unaffected by this schema — `config` stores IDs/values as submitted; F229's reader is responsible for treating a dangling reference (e.g. a deleted status id inside `config.filters`) as "ignore this filter" rather than erroring, since the DB has no FK from inside the jsonb payload to enforce that.
- Pre-existing, unrelated infra condition discovered while writing the cascade test: `supabase.auth.admin.deleteUser()` (the Admin API) fails with `AuthRetryableFetchError: Database error deleting user` for ANY user that has even a single `workspace_members` row — reproduced in isolation with zero `saved_views` rows involved at all. This is not something F227 introduced or can fix from a migration; it looks like a GoTrue/Auth-Admin-API-side issue unrelated to any RLS/FK in this repo's schema. Worth a dedicated investigation feature if it starts blocking other cascade-delete tests mission-wide (it did not block this feature's own test, which handles the known failure gracefully and still asserts the FK is `on delete cascade` via the project-level cascade test in the same file).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
See "Decisions made" above — all four AUTONOMOUS_DECISION entries are inline there per the clarification's "simpler option, no new dependency, no second source of truth" instruction.

## Notes for the next worker
- Supabase MCP was listed as `Worker use: Optional` in mcp-registry.md and reported "Pending approval" at connect time; per the registry note ("never block on MCP approval"), schema work went through the Supabase CLI (`supabase db push` / `supabase gen types typescript --linked`) directly against the linked project `qcipqonnqajmazdbysow`, matching every recent sibling migration's own convention. No MCP tool calls were made or needed for this feature.
- `public.is_project_visible_to(project_id)` and `public.is_active_workspace_member(workspace_id)` are the two SECURITY DEFINER helpers reused for shared-view visibility — do not copy-paste either predicate in F228/F229.
- The migration file has extensive header comments explaining every design choice (data shape, visibility branching, RLS floor for UPDATE/DELETE, cascade behaviour) — read it before starting F228, it answers most of the "why is it shaped this way" questions in advance.
- tests/integration/rls-saved-views.test.ts is schema-only (no Server Actions exist yet) and drives `saved_views` directly through each test user's own signed-in client — F228's own integration tests should instead drive the real Server Actions, same pattern as tests/integration/f226-swimlane-collapse-persist.test.ts.
