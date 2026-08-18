# M3 (Projects) — Scrutiny Report

Mission: 20260817-230717 · Reviewed features F024–F032 · Assertions AS-025–AS-042

Method: 9 parallel adversarial code reviews (one per feature, given only assertion text + files-changed, no handoff narrative), plus independent test/lint/typecheck runs.

## Command results

- `npx vitest run` — PASS (29 files, 151 tests, exit 0)
- `npx eslint .` — PASS (0 errors, exit 0)
- `npx tsc --noEmit` — PASS (exit 0)

## Assertion-by-assertion verdicts

| Assertion | Verdict | Reason |
|---|---|---|
| AS-025 | PASS | `createProject` (lib/actions/projects.ts) creates project with required name, optional description; re-checks membership via `requireActiveMembership` before insert; tests exercise the real action + DB round-trip. |
| AS-026 | **FAIL** (major) | DB only has `name text not null` (supabase/migrations/20260818004413_create_projects.sql:20) — this rejects `NULL` but **not** an empty string `''`. The migration's own comment claims "the database rejects it server-side" (AS-026 wording) but there is no `CHECK (length(btrim(name)) > 0)` or equivalent. Client-side Zod `.min(1)` is the only real guard; if it were ever bypassed (direct insert, future API, script) an empty-name project would succeed. No test attempts a direct DB insert with `name=''` to prove/disprove this — the only DB-level test in this feature area covers AS-035's date constraint, not AS-026's name constraint. |
| AS-027 | PASS | `getWorkspaceProjects` filters `deleted_at is null`, scoped by workspace_id; tests assert real workspace-scoped results. |
| AS-028 | PASS | RLS enabled on `projects` (migration 20260818004709_rls_projects.sql); SELECT/INSERT/UPDATE policies all gate through `is_active_workspace_member(workspace_id)`, not raw equality. Test (`tests/integration/rls-projects.test.ts`) uses a real signed-in non-member Supabase client issuing direct PostgREST calls — genuinely would fail if RLS were broken/missing. Minor uncovered edge: no test exercises a join from a related table (e.g. future `tasks`) that could leak project existence — flagged as a gap to watch when M4 lands, not a failure of this feature's own scope. |
| AS-029 | PASS | `editProject` uses admin client but independently calls `requireActiveMembership` before any read/write on every path; update is scoped by both `id` AND `workspace_id`, closing the IDOR the review specifically probed for. Real DB round-trip tests. |
| AS-030 | PASS | `archiveProject` uses admin client but `requireWorkspaceAdmin` (owner/admin only) runs before the single mutation path; test calls the action directly with a `member` session and asserts server-side rejection (not just UI-hidden button) for AS-033, and owner/admin success for AS-030. |
| AS-031 | PASS | `getWorkspaceProjects` filters `deleted_at is null`; archived (soft-deleted) projects verified excluded by test. |
| AS-032 | INCONCLUSIVE (minor) | Design is correct: `getProjectById` intentionally omits the `deleted_at is null` filter, scoped by workspace_id via the RLS-verified id from the layout — verified as the **critical special-attention item**: membership check (workspace lookup via RLS-backed query, `workspaces_select_active_members` policy) happens *before* the admin-client project fetch, and the verified `workspace.id` — not an unverified one — is what scopes the admin bypass query. Both `board/page.tsx` and `list/page.tsx` do no independent fetching, so there's no path around the layout's check. However, the "tasks remain intact and viewable" half of AS-032 is entirely untested (tasks table doesn't exist yet — correctly deferred to M4), and no test exercises `getProjectById`/the layout directly for the archived-project-view path (tests call the query function with hand-picked correct args, which is implementation-mirroring, not a true regression guard against a future refactor reintroducing a leak). Recommend re-verification once M4 tasks land, and a layout-level render test added to lock in the current correct behavior. |
| AS-033 | PASS | Server-side rejection genuinely tested by calling `archiveProject` with a `member`-role session, not just checking UI visibility. |
| AS-034 | **FAIL** (major) | `openTaskCount` is hardcoded to `null` everywhere in `lib/queries/projects.ts` (tasks table doesn't exist until M4). The assertion "shows ... a count of open (non-completed) tasks" is unmet — UI shows a static "pending" placeholder, not a count. The only test for this asserts the hardcoded null, which is implementation-mirroring and gives no signal toward the actual assertion. This is a legitimate scope/sequencing gap: AS-034 was assigned to F027 (M3) but depends on the tasks table (M4, not yet built) — assertion cannot be satisfied until M4 lands. |
| AS-035 | PASS | DB-level CHECK constraint `projects_end_date_after_start_date` (create+edit) plus Zod validation; edge cases (only one date set, equal dates) covered by real unit tests calling the exported schema. Edit path has a subtler correct behavior: a second explicit check against merged existing+new values covers partial-update cases the Zod `.refine` can't reach alone. |
| AS-036 | PASS | `created_by` taken only from `auth.getUser()` server-side, never a client-suppliable argument; `created_at` DB-defaulted, never passed in insert payload. |
| AS-037 | PASS | `updated_at` bump is DB-trigger-only (`set_updated_at`/`projects_set_updated_at`); no code path bypasses it. |
| AS-038 | PASS | Board/List tabs render for the project detail page; Table optional/Timeline out-of-scope respected. |
| AS-039 | PASS (with minor gap) | Nonexistent and cross-workspace projects both collapse to `null` → identical `notFound()` branch, no distinguishing signal (good, matches AS-144 pattern). Gap: no test exercises a syntactically malformed (non-UUID) project ID to confirm no 500 — behaviorally likely fine (Postgres errors caught and treated as `null`) but unverified by test. |
| AS-040 | PASS | `getProjectById` scopes by both `id` and `workspace_id` (the RLS-verified one) in a single query — a cross-workspace project never returns as `data`, so there is no partial-data render/flash risk; confirmed no code path renders project fields before the `notFound()` check. |
| AS-041 | INCONCLUSIVE (minor) | Currently only trivially true: `board/page.tsx` renders `BoardEmptyState` unconditionally with no data fetch at all (tasks table doesn't exist until M4), so "zero tasks" isn't actually being computed from real data — it can't yet be falsified by a fetch error or non-empty result. The CTA button is present but `disabled` with no `onClick`/context wiring. Tests are pure component-mirroring (render `BoardEmptyState` in isolation, assert static text) — no test touches `page.tsx`. Flag as a live risk for the M4 implementer: don't let a fetch error silently collapse into `tasks=[]` → empty state. Re-verify once M4 wires real task fetching. |
| AS-042 | PASS | Workspace-scoped project list test explicitly proves workspace A vs B isolation (asserts B's project absent from A's list and vice versa) — would fail if the `.eq("workspace_id", ...)` filter were removed, since the test user is a member of both workspaces (RLS alone wouldn't distinguish). |

## Summary counts

- PASS: 13 (AS-025, 027, 028, 029, 030, 031, 033, 035, 036, 037, 038, 040, 042)
- FAIL: 2 (AS-026, AS-034)
- INCONCLUSIVE: 3 (AS-032, AS-039 partial gap folded into PASS above — listed as PASS with noted minor gap; AS-032 and AS-041 are the true INCONCLUSIVE)

Restated cleanly: **13 PASS, 2 FAIL, 2 INCONCLUSIVE** (AS-039 counted as PASS-with-minor-gap, not INCONCLUSIVE, since the core assertion behavior is verified — only an edge-case malformed-UUID test is missing).

## Findings detail and severity

### FAIL — AS-026 (major)
**Summary:** The projects table has no DB-level constraint rejecting an empty-string `name`; only `NOT NULL` exists. The migration comment and the assertion text both claim DB-level rejection of empty names, which is false for `name=''`.
**File:** `supabase/migrations/20260818004413_create_projects.sql:20`
**Recommended follow-up (new feature spec):** Add a migration that introduces `constraint projects_name_not_blank check (length(btrim(name)) > 0)` on the `projects` table, and add an integration test that performs a direct admin-client insert with `name: ''` (bypassing the Server Action/Zod layer entirely) and asserts the insert is rejected by Postgres. This closes the actual gap the assertion describes (DB-level enforcement independent of the application layer).

### FAIL — AS-034 (major, sequencing gap not a code defect)
**Summary:** Open task count is a hardcoded `null`/"pending" placeholder because the `tasks` table doesn't exist until M4. The assertion cannot be satisfied within M3's actual dependencies.
**File:** `lib/queries/projects.ts` (openTaskCount hardcoded, ~lines 292, 318)
**Recommended follow-up (new feature spec):** Once M4's `db-schema-tasks` (F033) lands, add a follow-up feature "project-list-open-task-count" that replaces the hardcoded `null` with a real aggregate query (count of tasks per project where `status != 'done'` and `deleted_at is null`), update `getWorkspaceProjects` to join/aggregate correctly (avoiding N+1 by using a single grouped query or RPC), and add an integration test that seeds tasks in varying statuses and asserts the returned count matches only non-completed, non-deleted tasks. This assertion should not be marked complete until then.

### INCONCLUSIVE — AS-032 (minor)
**Summary:** The membership-check-before-admin-fetch pattern for viewing archived projects is verified correct in the current code, but the "tasks remain intact and viewable" half is entirely untested (no tasks table yet), and existing tests mirror the implementation (call `getProjectById` with hand-picked correct args) rather than rendering the actual layout, so a future regression reintroducing a leak would not be caught.
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx`, `lib/queries/projects.ts`
**Recommended follow-up:** Add a layout-level test (mocking `notFound`/`redirect`, invoking the layout function with mocked params) asserting it 404s a cross-workspace project without ever calling `getProjectById` with an unverified workspace id. Re-verify the tasks-visible-on-archived-project half once M4 tasks exist.

### INCONCLUSIVE — AS-041 (minor)
**Summary:** The empty-state currently renders unconditionally (no real data fetch exists yet), so "zero tasks detected → empty state" isn't actually implemented against real data; tests only render the component in isolation.
**File:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx`, `components/board/board-empty-state.tsx`
**Recommended follow-up:** When M4/M5 wire real task fetching into the board page, explicitly separate loading/error/empty branches (do not let a fetch error silently produce `tasks=[]` → empty state), wire the "create first task" CTA to actual project/workspace context, and add an integration test seeding zero tasks vs. a fetch-error condition to prove they render differently.

## Full command output

### npx vitest run
```
 Test Files  29 passed (29)
      Tests  151 passed (151)
   Start at  03:25:11
   Duration  21.48s
```
Exit code: 0

### npx eslint .
(no output — clean)
Exit code: 0

### npx tsc --noEmit
(no output — clean)
Exit code: 0
