# Handoff: F181 — task_templates table + RLS

## Status
COMPLETE

## Assertions covered
AS-328: PASS — `tests/integration/task-templates-rls.test.ts` "AS-328: a non-guest member can insert a task template with a cloneTaskFields-shaped payload, and it reads back unchanged" inserts a row with a `payload` mirroring F176's `cloneTaskFields` allow-list (title, description, description_json, priority, checklistItems, estimate_minutes, tags) and asserts it reads back byte-for-byte identical. A companion negative test ("AS-328: inserting a template with an empty name is rejected by the DB constraint") proves the `name` CHECK constraint. This proves the STORAGE half only — the actual "save as template" action is F182, not built yet, per this feature's own scope.
AS-329: PASS — five tests in the same file: a guest workspace member CANNOT see a template in their own workspace (RLS SELECT excludes guests); a regular member, an admin, and the owner CAN (non-guest active members); a member of a completely different workspace CANNOT (workspace scoping). All run against the real linked Supabase project with real signed-in users, not a mocked client.

## Files changed
supabase/migrations/20260822180000_task_templates.sql (new)
lib/supabase/database.types.ts (regenerated)
tests/integration/task-templates-rls.test.ts (new)

## Commands run
`supabase migration list --linked` (0) — pre-flight connectivity check, responded within seconds
`supabase db push --linked` (0) — applied `20260822180000_task_templates.sql` to the linked project
`supabase gen types typescript --project-id qcipqonnqajmazdbysow > lib/supabase/database.types.ts` (0)
`npx vitest run tests/integration/task-templates-rls.test.ts` (0 — 10/10 passed)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 3 pre-existing/incidental warnings — 2 pre-existing unrelated (`lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`), 1 in this feature's own test file fixed before final run)
`npm run test` (0 exit — 182/195 files, 1294/1336 tests passed, 32 skipped; the 13 failing files/10 failing tests are pre-existing `invite-member.test.ts`/`workspace-role-expansion.test.ts` Supabase-auth-rate-limit timeouts, identical class of pre-existing failure F170's handoff documented — none touch `task_templates`, `workspace_members` RLS predicates this migration reused, or any file this feature changed; this feature's own test file (`task-templates-rls.test.ts`) is not in the failure list)

## Decisions made
- **Single `task_templates` table with a `kind` discriminator (`'task' | 'project'`), NOT two separate tables — the explicit "decide here, not later" call this spec required.** Reasoning (also documented at length in the migration file's own header comment, since F184 depends on this): both task-level and future project-level (F184) templates share every column this table needs (id, workspace_id, name, payload jsonb, created_by, created_at) and, critically, share the exact same RLS shape (workspace-scoped, non-guest SELECT, creator-or-admin/owner write). Two tables would mean two copies of every policy kept in lockstep forever — exactly the "second source of truth" the clarified spec's ambiguity-resolution rule says to avoid. `payload` is jsonb for both kinds, so there's no relational column one kind needs that the other can't simply omit inside its own JSON. `kind` defaults to `'task'`, is CHECK-constrained to the two known values now (rather than deferring to a follow-up `ALTER TABLE` when F184 lands), and is indexed alongside `workspace_id` for F184's future `where kind = 'project'` filtered listing query.
- **`payload` shape is NOT DB-CHECK-validated** — per the clarified "validation mirrored in a Zod schema for the action layer" answer, the DB's role here is storage + access control; a useful CHECK constraint on an arbitrary jsonb shape that varies by `kind` isn't practical, and F182 (the actual save action, not yet built) owns the Zod schema that will validate the task-kind payload shape against `cloneTaskFields`'s allow-list before insert.
- **No new SQL helper function for the guest-exclusion predicate.** The clarified spec says "using the shared SQL helper rather than a copy-pasted predicate," but there is no existing reusable SQL function for the single-clause `wm.role <> 'guest'` check anywhere in the schema — F134's own guest scoping inlines this same predicate directly inside `is_project_visible_to`/`is_project_visible_to_row` rather than factoring it into a helper. This migration follows the same convention (inlines the identical `wm.role <> 'guest'` clause F134 established) rather than inventing a new abstraction the rest of the codebase doesn't already have — satisfies "reuse the same convention," not "copy-paste a DIFFERENT predicate."
- **INSERT policy requires `created_by = auth.uid()`** (not just workspace membership) — a guest is blocked from inserting too (their own predicate excludes guests), and a non-guest member can only ever insert a template attributed to themselves, preventing spoofed authorship.
- **UPDATE/DELETE policy: creator OR admin/owner**, mirroring the shape of the existing `workspace_logos_objects_*` admin-only policies in this schema, extended with the explicit creator branch this feature's Draft scope calls for.
- Indexed `workspace_id`, `(workspace_id, kind)`, and `created_by` per the clarified "index every FK and every WHERE/ORDER BY column" answer — these are the columns this feature's own read path (and F182/F184's future list-templates query) will filter/join on.

## Out-of-scope work needed
- **F182** — the actual "save current task as template" Server Action (Zod validation of the payload shape, wiring `cloneTaskFields` output into an insert). This feature only proves the table/RLS can accept a valid row.
- **F184** — project-level templates (payload holding a project's columns + ordered task list) using `kind = 'project'` on this same table. The table/RLS is ready for it; F184 only needs its own Zod schema and Server Actions, no new migration for the base table (though F184 may still want its own `payload`-shape-specific index or a partial index if `kind = 'project'` listing queries need one — not added here since no such query exists yet).
- No UI anywhere reads or writes `task_templates` yet — this is a pure DB feature per its own spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the single-table-with-discriminator design for task vs. project templates over two separate tables, per the clarified spec's own explicit instruction to decide this now and document it (see Decisions Made above) — no new dependency, one RLS surface to maintain, and F184 can start from this table with zero migration for the shared shape.
AUTONOMOUS_DECISION: Did not add a DB CHECK constraint validating `payload`'s internal shape (only that it's non-null jsonb) — deferred to F182/F184's Zod schemas at the action layer, per the clarified "DB is the last line, not the only line" answer, since a single CHECK can't usefully validate two different JSON shapes gated by `kind` without becoming a large ad-hoc JSON-shape validator duplicating what Zod already does better.

## Notes for the next worker
- The migration file `supabase/migrations/20260822180000_task_templates.sql` has an extensive header comment explaining the task-vs-project single-table decision — read it before touching this table in F182/F184, it's the single source of truth for "why one table."
- `lib/recurrence/clone-fields.ts`'s `cloneTaskFields`/`CLONEABLE_TASK_FIELDS` is the field allow-list F182 should reuse when building the task-kind `payload` (plus `tags`, which per F180's handoff is deliberately NOT part of `cloneTaskFields`'s own allow-list and must be added by the caller, same as `duplicateTask` does).
- No MCP tool calls made — used the CLI (`supabase db push --linked`, `supabase gen types typescript`), consistent with every other DB feature in this mission's recent handoffs (F170, F134, etc.); connectivity responded normally within seconds at the pre-flight check.
- The 13 pre-existing failing test files in the full suite run are Supabase-auth rate-limit timeouts unrelated to this feature — same class F170's handoff already documented; do not treat them as caused by this change.
