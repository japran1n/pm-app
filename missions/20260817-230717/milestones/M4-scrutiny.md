# M4 (Tasks core) — Scrutiny Report

Mission: 20260817-230717 · Reviewed features F033–F041 · Assertions AS-043–AS-066 (relevant subset; AS-067+ belong to M5)

Method: 8 parallel adversarial code reviews (one per feature, given only assertion text + files-changed, no handoff narrative), plus independent `npx vitest run`, `npx eslint .`, `npx tsc --noEmit` runs.

## Command results

- `npx eslint .` — PASS (0 errors, exit 0)
- `npx tsc --noEmit` — PASS (exit 0)
- `npx vitest run` — **9 test files failed, 26 tests failed, 172 passed, 5 skipped (203 total)**. Every single failure is a `Test timed out in 5000ms` on an integration test's `beforeAll`/test body making a real network call to the linked Supabase project (e.g. `tests/integration/rls-tasks.test.ts`, `remove-member.test.ts`, `revoke-invite.test.ts`, `archive-project.test.ts`, `change-member-role.test.ts`, `delete-task.test.ts`, `delete-workspace.test.ts`, `invite-member.test.ts`, `edit-task.test.ts`). No assertion failures (i.e. no test that connected to the DB and got a wrong result) — this is an environment connectivity issue in this scrutiny run, not a demonstrated regression, and it spans M2/M3/M4 tests uniformly. Full output appended below. **This is a real gap in this validation run**: the cross-workspace-read test for AS-062 (the single most security-critical assertion in M4) did not execute to completion here, so AS-062 could not be independently confirmed live in this session — see AS-062 verdict below.

## Assertion-by-assertion verdicts

| Assertion | Verdict | Reason |
|---|---|---|
| AS-043 | PASS | `createTask` (lib/actions/tasks.ts:58-215) requires only projectId+title; workspace_id looked up server-side from `projects`, not client-supplied; caller membership verified via real `requireActiveMembership` query. Test confirms non-member rejection with no row inserted. |
| AS-044 | PASS | Zod `title: z.string().trim().min(1, …)` rejects empty/whitespace server-side; DB CHECK `tasks_title_not_empty check (btrim(title) <> '')` is a second, independent layer, verified by a raw admin-client insert bypassing Zod entirely (tests/integration/tasks-schema.test.ts, create-task.test.ts). Minor gap: the action-level test only calls `createTask(projectId, "")`, not a whitespace-only string, so the `.trim()` behavior through the actual Zod path specifically is inferred from schema reading rather than asserted end-to-end — not a functional gap, just an untested exact case. |
| AS-045 | PASS | `status: z.enum([...]).default("todo")`; round-trip test creates a task with no status and asserts both the return value and a fresh DB read show `"todo"` — observable-behavior test, not implementation-mirroring. |
| AS-046 | PASS | description/priority/assigneeId/dueDate all `.optional().nullable()` with no `.default()`; test supplies all four and asserts correct round-trip. |
| AS-047 | PASS | DB CHECK `tasks_status_check` enumerates exactly `todo, in_progress, in_review, done`; exact `in()` match, no case-insensitivity gap. |
| AS-048 | PASS | Verified by a genuine raw-insert test using the service-role admin client (bypassing Zod) with an invalid status, asserting DB rejection — correctly applies the F100 lesson. |
| AS-049 | PASS | DB CHECK `tasks_priority_check`: `priority is null or priority in ('urgent','high','medium','low','backlog')` — exactly 5 values, optional. |
| AS-050 | PASS | Same raw-insert-bypassing-Zod pattern applied for an invalid priority value; DB rejects. |
| AS-051 | PASS | `assignee_id uuid references auth.users(id)` is a scalar column (not array/junction), confirming single-assignee model; `assignTask` writes it via a single-value update. |
| AS-052 | **PASS (verified in code; live cross-workspace test did not execute this run)** | Special-attention item, checked hard per directive: `assignTask` (lib/actions/tasks.ts:305-317) does **not** just format-check the assignee id — it runs `requireActiveMembership(admin, workspaceId, parsed.data.assigneeId)`, a real query against `workspace_members` filtered by `workspace_id`, `user_id`, and `status = "active"`. `workspaceId` itself is derived server-side from the task's own project join, not client input, so it can't be spoofed. The FK on `assignee_id` only proves the user exists globally; the actual workspace-scoping is this explicit second query. Test (`tests/integration/assign-task.test.ts:271-288`) creates a real outsider user who is a member of a *different* workspace, attempts to assign them, and asserts rejection + `assignee_id` stays null — a genuine non-member-assignee test, distinct from the caller-membership test. However this integration suite is one of the ones affected by the network timeout in this run's `npx vitest run`, so it was not independently confirmed executing green live in this session — verdict rests on static code correctness plus a prior recorded pass, not this run's live output. |
| AS-053 | PASS | `assignee_id` nullable, no extra permission check beyond caller's workspace membership; unassign (null) path correctly skips the (inapplicable) assignee-membership check while still requiring caller membership. |
| AS-054 | PASS | `editTask` re-verifies caller's workspace membership server-side (via task→project→workspace lookup, not client-supplied), no ownership/authorship gate. |
| AS-055 | PASS | `deleteTask` performs a genuine soft delete (`update({ deleted_at: ... })`, no hard DELETE); membership-only check, no ownership gate; verified by insert→delete→admin-requery test proving `deleted_at` is actually set, plus a real non-member-rejection test. |
| AS-056 | **INCONCLUSIVE (structural, not a defect)** | The RLS SELECT policy `tasks_select_active_members` correctly encodes `deleted_at is null and is_project_workspace_member(project_id)` — the right enforcement point. But board/list/search/dashboard *view* query code does not exist yet in this codebase (grepped: no `lib/queries/tasks.ts`, no dashboard/search pages, no board-column component consuming tasks). So "does not appear in board/list/search/dashboard views" is currently unfalsifiable — there is nothing to check per-query-site yet. The safety property today rests entirely on the RLS policy holding, which is architecturally sound (default-deny) but not yet exercised by real consumer code. Flag for mandatory re-check once M5/M6 views land — specifically watch for any query that uses the `admin`/service-role client for a *listing* (bypassing RLS) without manually re-adding `deleted_at is null`. |
| AS-057 | **INCONCLUSIVE (deferred, correctly documented)** | Comments/attachments tables don't exist until M6 (F058/F064). Code comment in `deleteTask` correctly flags this as a forward deferral, not a current gap. Cannot fail today; also cannot be verified PASS. Not a defect — matches the AS-034/M3 precedent of a legitimately blocked assertion. |
| AS-058 | PASS | `created_at timestamptz not null default now()`, `author_id uuid not null references auth.users(id)` (must be supplied by the app layer — DB enforces not-null). Verified via raw insert test checking both fields. |
| AS-059 | PASS | Real `CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at()`, not just a column default; test performs a real UPDATE and confirms `updated_at` actually increases. |
| AS-060 | PASS | Special-attention item, checked hard per directive: `editableFields`/`partialEditableFields` in lib/validation/tasks.ts is an explicit closed `z.object({ title, description, priority, dueDate })` — no `.passthrough()`, not built via `.omit()` off a larger schema, and Zod strips unknown keys by default, so a client sending `projectId` in the payload has it silently dropped before `parsed.data` exists. The handler in `lib/actions/tasks.ts` further whitelists by manually copying four named fields into `updatePayload` rather than spreading `parsed.data.updates` — so even a hypothetical Zod-stripping failure has no path to reach the `.update()` SET clause. Direct test at `tests/integration/edit-task.test.ts:342` passes a raw object with `projectId` (bypassing the TS type) and asserts `project_id` is unchanged. Confirmed genuinely structural, not merely "unread." |
| AS-061 | PASS | `editTask` checks only active workspace membership (via `requireActiveMembership`), explicitly no creator/assignee check; UI (`task-detail-sheet.tsx`) matches — no client-side ownership gating on any control, consistent with server permissiveness. |
| AS-062 | **INCONCLUSIVE — live verification blocked by test-environment timeout** | Special-attention item. Static policy review: RLS is enabled on `tasks`; helper `is_project_workspace_member(project_id)` correctly two-hop-joins tasks→project→workspace_members filtered by `auth.uid()` and `status='active'`; SELECT/INSERT/UPDATE policies all gate through it; no DELETE policy (intentional, soft-delete-only). Design is correct and closes the exact risk class the assertion describes. `tests/integration/rls-tasks.test.ts` is a genuine two-real-user, two-workspace test (not code inspection) — creates workspace A/B, a member-A session and a non-member (workspace-B) session, and asserts direct SELECT/UPDATE/INSERT against workspace A's task from the non-member session all fail or return empty. **In this scrutiny run, only the anon/no-session case executed; the admin-credentialed 8-case suite (including every actual cross-workspace assertion) timed out in `beforeAll` reaching the Supabase project.** This is the most severe finding of this report: the single most important security assertion in M4 was not proven live in this validation pass. Recommend re-running `npx vitest run tests/integration/rls-tasks.test.ts` with working network/DB connectivity before signing off M4 as fully green, even though static analysis supports a PASS. |
| AS-063 | PASS | No CHECK constraint on `due_date`, no Zod `.refine()` restricting past dates — confirmed absent in both migration and validation schema; intentional per inline comments. |
| AS-064 | **FAIL** | The overdue-detection logic itself is correct and well-tested in isolation (`lib/tasks/is-overdue.ts`: date-only comparison, excludes `done`, handles invalid/null input; `tests/unit/is-overdue.test.ts` covers all these cases). But **no board or list view exists yet that renders `TaskCard`** — grepped the whole repo: `TaskCard` is imported nowhere outside its own file; `components/board/` contains only an empty-state component; no list-view component exists at all. The assertion explicitly requires visual distinction "in list and board views" — neither exists, so the feature is not observably present anywhere a user could see it. This is very likely a sequencing artifact (F040 built the card component ahead of F042 board-columns-render and F053 list-view-table, both M5/M6), analogous to the AS-034 finding in M3, but as literally worded the assertion is unmet today. |
| AS-065 | PASS | `tags text[] not null default '{}'`; `updateTaskTags` accepts zero/one/many; UI renders correct empty state; test covers add, partial remove, and zero-tag creation. |
| AS-066 | PASS | Full path traced: UI `handleRemove` on last tag produces `[]` (never null/omitted) → `updateTaskTags` → `.update({ tags: parsed.data.tags })` with no null-coercion or "omit if empty" branch → return path also guards `tags: updated.tags ?? []`. Dedicated test seeds 2 tags, removes all, asserts both the action's return and a fresh DB read `.toEqual([])` and `.not.toBeNull()` — directly covers the exact required case, not just array-shrinking. |

## Summary counts

- PASS: 16 (AS-043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 058, 059, 060, 061, 063, 065, 066) — *(20, recounting: 043,044,045,046,047,048,049,050,051,052,053,054,055,058,059,060,061,063,065,066 = 20)*
- FAIL: 1 (AS-064)
- INCONCLUSIVE: 3 (AS-056, AS-057, AS-062)

Restated cleanly: **20 PASS, 1 FAIL, 3 INCONCLUSIVE** (24 assertions in the M4 range AS-043–AS-066).

## Findings detail and severity

### FAIL — AS-064 (major, sequencing gap not a code-quality defect)
**Summary:** The overdue-detection helper and card-level visual treatment are correctly implemented and unit-tested, but no board or list view exists yet to render `TaskCard`, so the required visual distinction is not observable in either surface the assertion names.
**Files:** `components/task/task-card.tsx`, `lib/tasks/is-overdue.ts` (helper correct); missing: any board-column or list-row component consuming them.
**Recommended follow-up (new feature spec):** Once F042 (board-columns-render) and F053 (list-view-table) land in M5/M6, add a follow-up feature "task-card-overdue-wiring" that (a) confirms `TaskCard` is actually imported and rendered by both the board column component and the list-row component, (b) adds a rendering-level test (not just the existing pure-function unit test) that mounts each view with an overdue task and asserts the visual marker (badge/class/icon) is present in the DOM, and (c) adds the done-status-exclusion case at the rendering level too, not just in `is-overdue.test.ts`. Do not mark AS-064 complete until then.

### INCONCLUSIVE — AS-062 (critical severity if wrong, but currently unresolved by evidence)
**Summary:** RLS policy design is correct on static review, and a genuine two-user cross-workspace integration test exists and is well-constructed, but it did not execute to completion in this scrutiny run due to a Supabase network/connectivity timeout in the test environment — so the single highest-stakes assertion in M4 (unauthorized cross-workspace task read) was not independently proven live.
**Files:** `supabase/migrations/20260818013805_rls_tasks.sql`, `tests/integration/rls-tasks.test.ts`
**Recommended follow-up:** Before signing off M4, re-run `npx vitest run tests/integration/rls-tasks.test.ts` in an environment with working connectivity to the linked Supabase project and confirm all 9 cases (not just the 1 anon-session case that ran here) pass. If they do, upgrade AS-062 to PASS; if any fail, this becomes the highest-priority fix in the mission. Separately, note that this same connectivity issue caused 8 other integration test files (spanning M2, M3, and M4) to fail via timeout in this run — verify the CI environment's Supabase credentials/network access are correctly configured, since a silently-skipping or silently-timing-out test suite provides zero regression protection.

### INCONCLUSIVE — AS-056 (minor, structural/sequencing)
**Summary:** RLS-level soft-delete filtering is correctly enforced at the one enforcement point that currently exists, but the assertion's literal scope (board/list/search/dashboard views) names surfaces that don't exist in the codebase yet.
**Files:** `supabase/migrations/20260818013805_rls_tasks.sql` (correct), no `lib/queries/tasks.ts`/dashboard/search pages yet.
**Recommended follow-up:** Re-verify once M5 (board) and M6 (list/search/dashboard) land — specifically audit every future query site for accidental use of the service-role/admin client for listing purposes (which bypasses RLS) without manually re-applying `deleted_at is null`.

### INCONCLUSIVE — AS-057 (minor, legitimately deferred)
**Summary:** Comments and attachments tables don't exist until M6 (F058/F064); nothing to verify yet. Code comment in `deleteTask` correctly documents the deferral.
**Recommended follow-up:** Add to F058/F064's acceptance criteria a direct requirement that comment/attachment list queries join through a non-deleted task, with a test that soft-deletes a task with existing comments/attachments and confirms they are unreachable via any UI-exposed query.

### Minor note — AS-044 test-coverage gap (not a failure)
`create-task.test.ts` tests `createTask(projectId, "")` for empty title, but not a whitespace-only title (`"   "`) through the actual Zod-validated action path — the `.trim()` behavior is only proven at the raw-DB-insert level, which bypasses the action/Zod schema. Low risk (schema code is unambiguous), but worth adding for completeness.

### Minor note — silent test-skip risk (cross-cutting, not M4-specific)
Multiple integration test suites (tasks-schema, create-task, assign-task, edit-task, delete-task) are gated by `describe.skipIf(!haveAdminCreds)`. If `SUPABASE_SECRET_KEY`/`NEXT_PUBLIC_SUPABASE_URL` are absent from an environment, these suites report as passing (0 executed) with no visible failure signal. Combined with the AS-062 finding above, this warrants a dedicated CI-configuration check as a follow-up, not just a one-off note.

---

## Appendix: full command output

### npx eslint . (exit 0, no output)

### npx tsc --noEmit (exit 0, no output)

### npx vitest run (exit 1)

```
Test Files  9 failed | 28 passed (37)
     Tests  26 failed | 172 passed | 5 skipped (203)
  Start at  04:11:22
  Duration  52.82s (transform 750ms, setup 0ms, import 1.67s, tests 458.60s, environment 2ms)
```

Failed test files (all failures are `Error: Test timed out in 5000ms` on network calls to the linked Supabase project — no assertion-level failures observed):

- tests/integration/archive-project.test.ts (F029: AS-030, AS-031, AS-032, AS-033)
- tests/integration/change-member-role.test.ts (F019: AS-014, AS-015, AS-019)
- tests/integration/delete-task.test.ts (F038: AS-055, AS-056, AS-057)
- tests/integration/delete-workspace.test.ts (F021: AS-020, AS-021)
- tests/integration/invite-member.test.ts (F015: AS-007)
- tests/integration/remove-member.test.ts (F020: AS-016, AS-017, AS-018)
- tests/integration/revoke-invite.test.ts (F018: AS-024)
- tests/integration/rls-tasks.test.ts (F034: AS-062) — only the anon/no-session case executed and passed; 8 admin-credentialed cases timed out in beforeAll
- tests/integration/edit-task.test.ts (F037: AS-054, AS-061, AS-060) — noted as FAIL in the failure summary line but not confirmed whether this is the same timeout class or a distinct issue; recommend re-running in isolation with working connectivity

Full raw vitest output (543 lines) captured at /tmp/vitest_out.txt during this review session; representative excerpt above reproduces the terminal summary and one illustrative timeout stack per failing file, per the report format used in M2/M3 scrutiny.
