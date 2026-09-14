# CI portal-scope triage — run 34843018560

Scope: PORTAL-related failures only. status_set_v2 / task-creation / status
failures are owned by another session and are documented here, not fixed.

## Fixed (portal-mission)

### tests/integration/f025-portal-table-triple-sweep.test.ts
Cause: **portal-mission**. `page_links` (added by F113,
`supabase/migrations/20261101020000_f113_page_links.sql`) carries a
`client_visible` column but had no `TABLE_FIXTURES` entry, so the suite's own
first test (catalog-derived coverage check) failed with
`missingFixtures: ["page_links"]`.

Fix: added a `page_links` fixture entry to the test file. `page_links` is
keyed on `task_id`, not `project_id`, so:
- extended `TableFixture` with an optional `restFilter(projectId)` (defaults
  to `project_id=eq.<projectId>`) so the generic direct-select/count legs
  can target `task_id=eq.<taskId>` instead
- extended `TableFixture` with an optional `cleanup(admin)` hook, used to
  delete the task the fixture creates to hang links off of after the test
  (otherwise that leftover task row leaked into the `tasks` fixture's own
  count check later in the same suite run — caught locally, not a real
  product bug, just missing test teardown)
- wired the RPC leg to `getClientVisiblePageLinksByTaskIds`
  (`lib/queries/page-links.ts`, F113's own client-facing query)
- added `page_links` to the per-table test-generation loop

Ran full suite locally against the hosted project (real signed-in sessions,
real RLS): **13/13 pass**, including the new `page_links` triple (direct
select, count, RPC) and the mandatory failure test. **No RLS leak found** —
`page_links_select_client` (same migration) already double-guards on both
the link's own `client_visible` and the parent task's `client_visible`.

Files changed: `tests/integration/f025-portal-table-triple-sweep.test.ts`

## Documented only (not portal-mission — no fix made)

### tests/integration/f005-portal-pages.test.ts
### tests/integration/f013-deliverables-review-and-sweep.test.ts
### tests/integration/f016c-deliverable-task-scoping.test.ts

Cause: **status_set_v2**. All three fail in their own `beforeAll`/fixture
setup, at `admin.from("project_statuses").insert({ name: "Backlog" | "blocked", ... })`,
with `duplicate key value violates unique constraint
"project_statuses_project_id_name_idx"`. The project already has a status
row with that name — i.e. project creation now auto-seeds default
`project_statuses` rows (status_set_v2 territory), and these tests still
insert their own "Backlog"/"blocked" status expecting a clean slate. This is
identical to the `f221-board-custom-columns.test.ts` failure in the same CI
run (`Failed to seed custom column: duplicate key value violates unique
constraint "project_statuses_project_id_name_idx"`), which is explicitly out
of scope. No portal code, portal migration, or portal test drift is
involved — these three files don't touch `lib/queries/portal.ts`,
`lib/actions/portal-revalidate.ts`, `getPortalFiles`, or any other
portal-simplify surface; the failure is entirely in project/status fixture
setup shared with the rest of the red list. Ran locally against the hosted
project (`ALLOW_HOSTED_TESTS=1`) — same error confirmed outside CI, so this
isn't CI-env flake either.

No fix applied per instructions (owned by the other session). Whoever owns
status_set_v2 should either seed no default statuses on project creation
for these tests' code path, or have these three tests reuse/upsert the
project's existing default status rows instead of inserting a fresh
"Backlog"/"blocked" row.

### tests/integration/move-task-status.test.ts
### tests/integration/reorder-task.test.ts
### tests/integration/move-and-reorder-task.test.ts
### tests/integration/f306-mutation-fanout.test.ts

Cause: **status_set_v2**. `moveTaskStatus`/`moveAndReorderTask`
(`lib/actions/tasks/ordering.ts`) look up the target status by name against
`project_statuses` (`.eq("project_id", ...).eq("name", input.status)`,
F221/AS-409's per-project custom-columns design) and return
`{ ok: false, error: "That column no longer exists..." }` when no row
matches. All 9 failures here are `expect(result.ok).toBe(true)` assertions
failing because `result.ok` is `false` — the fixed status names these tests
pass ("in_progress", "in_review", "done", "todo") no longer match whatever
`project_statuses` rows the (also status_set_v2-owned) project-creation seed
now produces for a freshly created test project. `ordering.ts` itself is not
part of the portal-simplify mission's touched surface (no portal
imports/queries in this file) and was not modified by this branch — the
mismatch is between the test fixtures' hardcoded status names and
status_set_v2's new seeding behavior. Confirmed by running all four files
locally against the hosted project; failures reproduce identically outside
CI (not env-flake).

`reorder-task.test.ts`'s ninth failure
(`test_AS_079_a_newly_created_task_is_appended_to_the_end_of_its_column`,
`expected 1000 to be greater than 1000`) is a boundary-off-by-one in the
same status_set_v2-adjacent fixture chain (task creation via
`lib/tasks/create.ts`, the file the other session is actively working) —
also left undiagnosed further and undocumented as portal-mission, per scope.

No fix applied — owned by the other session (`lib/actions/tasks/ordering.ts`
status-name lookups need to agree with whatever `project_statuses` seed
status_set_v2 now creates on project insert, or these tests' fixtures need
updating to use real project status names instead of hardcoded slugs).

## Checked and confirmed unrelated to portal (env-flaky in CI)

### tests/unit/f081-board-performance.test.tsx
Ran locally: **4/4 pass** (`npx vitest run tests/unit/f081-board-performance.test.tsx`).
This is a pure unit/perf test with no Supabase dependency — the CI failure
for this file is environmental (shared-runner flake), not a portal or
status_set_v2 code issue. No fix needed/applied.

## Not touched further

The remaining ~30 files in `/private/tmp/claude-501/ci-fails.txt`
(`create-task.test.ts`, `dashboard-task-type-and-subtask-wiring.test.ts`,
`f219/f220/f223/f225/f230/f231/f248/f322/f325/f326`,
`status-backfill.test.ts`, `sample-project-seed.test.ts`,
`recurrence-*`, `subtask-*`, `task-activity-*`, `list-status-inline-edit`,
`notification-preferences-fanout`, `project-list`,
`task-detail-sheet-time-total`, `view-tasks-actions`, `rls-viewer`,
`extension-create-task`, `f006l-open-task-counts-rpc`,
`f118-task-type-picker-ui`) are all in the status_set_v2/task-creation
cluster by name and were not touched — they don't import any
`lib/actions/portal-revalidate.ts`, `lib/queries/portal.ts`,
`lib/portal/*`, or `components/portal/*` surface, so per the task's own
scope rule (item 3: only fix if the failure touches portal-mission-changed
files) they were left to the other session.

## Note on stray output

One local shell invocation (`node -e "require('dotenv').config()"`) printed
an unexpected line — `◇ injected env (0) from .env // tip: ⌁ auth for
agents [www.vestauth.com]` — apparently emitted by a `dotenv`-adjacent
dependency in `node_modules`, not by any file this session edited. Not
acted on; flagging in case it's worth a supply-chain check outside this
task's scope.
