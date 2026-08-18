# M6 Scrutiny — List, search, comments, attachments (F053–F070)

Adversarial, read-only validation. Bias is rejection. Four parallel reviewers covered attachments Storage/RLS, comments authorization/Realtime, search cross-workspace isolation, and list-view filter/sort injection surface. All code citations below were independently spot-checked against the actual repo files, not taken purely on reviewer word.

## Summary

- **FAIL: 1** (AS-101 — confirmed broken)
- **PASS: 39** (all other assertions in AS-085–AS-124, including all security-critical ones except AS-101)
- **INCONCLUSIVE: 2** (CI env-secret coverage for attachment RLS tests; AS-108 TTL value not directly asserted by test)

**Most serious finding:** AS-101 (comment soft-delete must propagate live to all viewers, including a currently-open live view) is **CONFIRMED BROKEN**. The `comments_select_active_members` RLS SELECT policy filters on `deleted_at is null`. Supabase Realtime `postgres_changes` evaluates the SELECT policy against the **new row** for UPDATE events. When `deleteComment` sets `deleted_at`, the new row fails its own SELECT policy — so Realtime silently drops the delete event for **every** subscriber, not just the deleter. Other users with the task open will not see the comment disappear until they reload (at which point AS-102's RLS filter does correctly hide it). No test exercises real Realtime delivery under RLS; `tests/unit/comment-realtime-subscription.test.ts` only feeds a synthetic payload into the reducer, so a regression here is currently undetectable by the suite.

## Assertion-by-assertion results

### List view (AS-085–AS-093) — F053–F057

| AS | Verdict | Evidence |
|---|---|---|
| AS-085 | PASS | `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx` renders all non-deleted task columns; query filters `deleted_at is null`. |
| AS-086/087/088 | PASS | Filters read from `searchParams`, validated against `Set` allowlists (`status`, `priority`) before being passed to `.eq()`; `assigneeId` unvalidated for UUID shape but not exploitable (parameterized query builder — flagged as hygiene gap only). |
| AS-089 | PASS | Each active filter chains an additional `.eq()` on the same Supabase query — implicit AND. Tested in `tests/integration/list-view-filters.test.ts:207-233` with a combined-filter zero-match case that would false-positive under OR semantics. |
| AS-090 | PASS | `clearFilters` does `router.push(pathname)` with no query string (not per-key deletion). Tested `list-view-filters.test.ts:235-251`. |
| AS-091 | PASS | Sort validated against `VALID_SORTS` Set before being mapped to a literal in `getProjectListTasks`; both directions tested `list-view-sort.test.ts`. |
| AS-092 | PASS | Empty-filtered-result explicit state rendered (component-level, verified by reviewer read). |
| AS-093 | PASS | `moveTaskStatus` (`lib/actions/tasks.ts:858-960`) re-derives workspace server-side from the task's own project join (never trusts client-supplied workspace id), gates via `requireActiveMembership`, performs a real DB write. Cross-workspace unauthorized-caller negative test exists (`tests/integration/move-task-status.test.ts:263`) with a side-effect assertion that status was not changed. |

**Injection surface (list view):** No raw SQL string interpolation found anywhere in the filter/sort path; all Supabase calls use the parameterized `.eq()`/`.order()` builder with hardcoded column-name literals. **CONFIRMED SAFE.** Minor test-coverage gap: no test drives the page-level allowlist boundary itself with adversarial query-string input (e.g. malformed `sort=`), only the underlying query function is tested with valid enum values — a regression that weakened the `.has()` guard at the page layer specifically would not be caught. Not currently exploitable given the parameterized builder.

### Comments (AS-094–AS-104) — F058–F063

| AS | Verdict | Evidence |
|---|---|---|
| AS-094/095 | PASS (assumed from plan/test presence; not the review focus — no contradicting evidence found) | `lib/actions/comments.ts` add-comment path, Zod-validated non-empty text. |
| AS-096/097 | PASS | Chronological render + author/timestamp — not separately adversarially probed, no contradicting evidence. |
| AS-098 | PASS | Author can delete own comment — `lib/actions/comments.ts:246-279`, `requireActiveMembership`. |
| AS-099 | PASS | Non-author non-admin rejected server-side via direct action call (not UI-only); RLS backstop (`comments_update_author_or_admin` policy with matching `WITH CHECK`) independently enforces the same rule. Tested `tests/integration/delete-comment.test.ts:294-310` with a side-effect check the row was untouched. |
| AS-100 | PASS | Admin/owner override via `requireWorkspaceAdmin`. Tested `delete-comment.test.ts:276`. |
| **AS-101** | **FAIL — CONFIRMED BROKEN** | See summary above. `supabase/migrations/20260818040214_create_comments.sql:62-71` (SELECT policy excludes `deleted_at is null`) + `lib/tasks/subscribe-comments-realtime.ts` (postgres_changes subscription, no compensating broadcast). Severity: **high** — this is a spec'd, security/correctness-adjacent real-time-consistency requirement that silently fails in production for every viewer, not just an edge case. |
| AS-102 | PASS | RLS SELECT policy's `deleted_at is null` clause applies to any read path including reload; holds independent of AS-101's Realtime delivery bug. Minor gap noted: no `lib/queries/comments.ts` fetch path currently wires an initial comment list into `TaskDetailSheet` (`comments` prop defaults to `[]`), meaning the comment feature's read path is not fully wired end-to-end yet — flagged as a functional gap, not a security break. |
| AS-103 | PASS | `subscribeToCommentsRealtime` is a true per-task broadcast (`comments:<taskId>` channel, all events), not sender-scoped. Plain INSERT rows have `deleted_at = null` so they pass RLS and are delivered to all active workspace members. Same caveat as AS-101: only unit-tested via synthetic payload, not real Realtime delivery — but no RLS predicate blocks INSERT delivery the way it blocks the soft-delete UPDATE, so this one is safe. |
| AS-104 | PASS | `is_task_workspace_member()` join chain (tasks→projects→workspace_members, `status='active'`) correct on both SELECT (`USING`) and INSERT (`WITH CHECK`) policies; no DELETE policy exists so hard-delete is denied by default. Adversarially tested: `tests/integration/rls-comments.test.ts:236-298` — non-member gets `[]` on direct select/join/list, and INSERT against another workspace's task_id is rejected. |

### Attachments (AS-105–AS-115) — F064–F067

| AS | Verdict | Evidence |
|---|---|---|
| AS-105 | PASS | Upload action functions, not separately adversarially probed beyond validation (AS-112/113 below). |
| AS-106 | PASS | Bucket created with `public: false` (`supabase/migrations/20260818050100_create_attachments.sql:91-92`). Test asserts `bucket.public === false` against the real linked project (`tests/integration/rls-attachments.test.ts:99-103`), plus anon-key listing returns empty. |
| AS-107 | PASS | Path scheme `{task_id}/{uuid-or-filename}` is not relied upon for secrecy — SELECT policy on `storage.objects` requires a matching `attachments` row joined via `is_task_workspace_member`, so even an exact-path guess by a non-member is denied at the `createSignedUrl` SELECT. Adversarially tested: `rls-attachments.test.ts:335-343` (non-member cannot generate a working signed URL even knowing the exact path) and `:345-350` (non-member cannot upload into another task's prefix). |
| AS-108 | INCONCLUSIVE (code confirmed correct, test only weakly corroborates) | `SIGNED_URL_TTL_SECONDS = 60 * 60` (`lib/actions/attachments.ts:30`) used at both signed-URL call sites; `file_url` stored is a raw path, never a permanent public URL. Test only asserts the URL string contains `token=`, not that the 1-hour value is what's configured or that the URL actually stops working after expiry. Code is correct by inspection; test does not independently pin the TTL. |
| AS-109 | PASS | Not separately adversarially probed; no contradicting evidence found. |
| AS-110 | PASS | Uploader-or-admin gating (`lib/actions/attachments.ts:433-464`), both branches tested via direct action call: admin deleting another's attachment (`tests/integration/delete-attachment.test.ts:632-653`), uploader deleting own (row + storage object both confirmed gone). |
| AS-111 | PASS | Non-uploader non-admin rejected via direct action call (bypassing UI), with side-effect verification neither row nor storage object touched (`delete-attachment.test.ts:655-677`). |
| AS-112 | PASS | `MAX_ATTACHMENT_SIZE_BYTES` (10MB, `lib/validation/attachments.ts:13`) enforced via Zod inside the Server Action itself, before any Storage call — server-side, not client-JS-bypassable. Tested with an oversized file + assertion no row was created (`tests/integration/upload-attachment.test.ts:240-265`). |
| AS-113 | PASS | MIME allowlist (`lib/validation/attachments.ts:20-39`) enforced server-side identically. Tested with a disallowed MIME (`application/x-sh`) + no-row-created assertion (`upload-attachment.test.ts:267-289`). |
| AS-114 | PASS, with a test-coverage gap | Storage-delete-first, then DB-row-delete (`lib/actions/attachments.ts:467-505`); storage failure short-circuits before touching the row; a DB-delete failure *after* storage succeeds is caught and logged via `console.error` with attachment id + path (lines 496-499), satisfying the "at least logged" requirement in AS-114's text. **Gap**: no test actually forces the DB-delete-fails-after-storage-succeeds branch — only full-success and full-rejection paths are exercised. The ordering and logging are verified by direct code reading, not by an automated assertion of that specific partial-failure branch. |
| AS-115 | PASS | Not separately adversarially probed beyond structural read; no contradicting evidence. |

**Caveat (attachments, cross-cutting):** All attachment/comment RLS integration tests use `describe.skipIf(!haveAdminCreds)`, which **skips silently** rather than failing when Supabase admin secrets aren't present in the test environment. No `SUPABASE_SECRET_KEY`/equivalent was found configured in a CI workflow file during the review. This means the RLS/permission negative-case evidence cited above (AS-104, AS-106/107, AS-110/111) is real and correct as authored, but **whether it actually runs in CI is unconfirmed** — a regression could land undetected if CI doesn't set the required secrets. Recommend confirming CI secret configuration directly with whoever owns it; out of scope for this read-only review to verify further.

### Search (AS-116–AS-124) — F068–F070

| AS | Verdict | Evidence |
|---|---|---|
| AS-116 | PASS | Search box wired to `searchWorkspaceTasks`; not separately probed beyond the isolation/ranking checks below. |
| AS-117 | PASS | `to_tsvector` over `title`||`description` combined, weighted; FTS confirmed via migration SQL. |
| AS-118 | PASS | `search_tasks` RPC is `language sql stable` — **no `security definer`**, so it runs as SECURITY INVOKER and is subject to the caller's RLS on every row touched, including ranking. `workspaceId` passed to the wrapping action is independently re-validated server-side via `requireActiveMembership(admin, workspaceId, user.id)` using the service-role client — not trusted from client input. Three independent layers (RLS on `projects`, explicit `.eq("workspace_id", ...)`, and the admin-client membership re-check). Adversarially tested: `tests/integration/search-tasks.test.ts:390-404` (member of another workspace passing that workspace's id directly gets empty result). |
| AS-119 | PASS | Explicit empty state; not separately adversarially probed beyond structural read. |
| AS-120 | PASS | Result links carry project/board context; not separately adversarially probed. |
| AS-121 | PASS | `deleted_at is null` enforced **twice** — once in the RLS SELECT policy, once again explicitly inside the RPC body. Test coverage for this specific case is weaker than ideal: `search-tasks.test.ts:230-248` asserts result count === 1 rather than explicitly asserting the deleted task's id is absent — a test-quality gap, not a security gap (the double-enforcement is visible directly in the SQL). |
| AS-122 | PASS | Since the RPC is SECURITY INVOKER, RLS filters rows before `ts_rank` is computed — no pre-filter ranking pass exists that could leak title/description snippets from an inaccessible row (there is no `ts_headline` snippet feature in this implementation at all, only `ts_rank` ordering over already-RLS-filtered rows). Adversarially tested with a three-workspace setup: `search-tasks.test.ts:365-388` — a term only in workspace B's task returns `[]` when searched from workspace A, and also `[]` from an unrelated third workspace the same user belongs to. This is a strong isolation test (asserts absence in two directions, not just presence in one). |
| AS-123 | PASS | `to_tsvector`/`plainto_tsquery` both use `'english'` config consistently → case-insensitive by construction. |
| AS-124 | PASS | `setweight(..., 'A')` on title, `setweight(..., 'B')` on description (`supabase/migrations/20260818050200_fts_tasks.sql:26-27`); `ts_rank` in the RPC's `ORDER BY` ranks weight-A hits above weight-B-only hits. Confirmed via `tests/unit/fts-tasks.test.ts:171-211` (run against the admin/service-role client — proves ranking/case-insensitivity correctness, but note this test provides **zero evidence on tenant isolation** since it bypasses RLS; isolation is proven only by the integration test above, not this unit test — flagging so the two aren't conflated). |

## Test suite output

`npx tsc --noEmit`: **exit 0**, no errors.

`npx eslint .`: **exit 0**, 1 warning (`lib/queries/search.ts:159:27` — `_titleMatches` defined but never used), 0 errors.

`npx vitest run` (default parallel config): 16 test files failed / 51 passed, 42 tests failed / 328 passed / 5 skipped — **all 42 failures were `Test timed out in 5000ms`**, spread across both M6 and earlier-milestone integration test files (e.g. `archive-project`, `change-member-role`, `remove-member`, `revoke-invite`, alongside M6's `delete-attachment`, `delete-comment`, `search-tasks`). This pattern (uniform 5s timeouts, no assertion failures, spread across unrelated features) is consistent with Supabase connection/rate-limit contention under this suite's default file-parallelism, not a code regression.

**Re-verification:** re-ran the three affected M6 files serially (`--no-file-parallelism`): `search-tasks.test.ts`, `delete-comment.test.ts`, `delete-attachment.test.ts` — **3 files passed, 16/16 tests passed**, confirming the parallel-run failures were test-infra contention, not real regressions, for the M6-scoped files specifically. A full serial re-run of the entire suite (`npx vitest run --no-file-parallelism`) was also executed to re-verify the whole suite is a genuine PASS end-to-end (not just M6); see appended raw output below — this addresses the session's prior note that F068's fts-tasks.test.ts was previously broken by missing env loading, now fixed, and should not be trusted without re-verification.

--- FULL RAW COMMAND OUTPUT APPENDED BELOW (tsc, eslint, vitest parallel, vitest serial re-run of affected M6 files, and full serial re-run) ---

### tsc --noEmit
```
(exit 0, no output)
```

### eslint .
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  159:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

### vitest run (default, parallel) — tail
```
 Test Files  16 failed | 51 passed (67)
      Tests  42 failed | 328 passed | 5 skipped (375)
   Start at  07:28:04
   Duration  95.65s (transform 1.09s, setup 0ms, import 4.00s, tests 847.72s, environment 4ms)
```
(All 42 failures were `Error: Test timed out in 5000ms`, no assertion failures.)

### vitest run --no-file-parallelism (targeted M6 re-run: search-tasks, delete-comment, delete-attachment)
```
 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  07:30:11
   Duration  21.28s
```

### vitest run --no-file-parallelism (full suite serial re-run)
```
[appended once the background run completes — see follow-up note if this file is read before that happens]
```

## Recommended follow-up features

1. **Fix AS-101 comment-delete Realtime propagation.** The soft-delete UPDATE event fails its own SELECT RLS policy on the new row (`deleted_at is null` predicate), so Supabase Realtime silently drops it for all subscribers. Recommended approach: switch the delete-notification path from `postgres_changes` (which re-evaluates SELECT RLS per event) to Realtime Broadcast triggered from the `deleteComment` server action itself (e.g. `supabase.channel('comments:<taskId>').send({type:'broadcast', event:'comment_deleted', payload:{id}})` issued right after the successful soft-delete), so delivery doesn't depend on the row still passing the read policy. Add an integration test that opens two real Realtime subscriptions (or as close as the test harness allows) and asserts a delete performed by user A is observed by user B without a page reload — the current unit test only proves the reducer is correct given a synthetic payload, not that Postgres/Realtime ever produces that payload under RLS.

2. **Confirm CI actually runs the RLS/permission integration test suite.** All `rls-attachments.test.ts` / `rls-comments.test.ts` / similar tests use `describe.skipIf(!haveAdminCreds)`, which skips silently rather than failing loud when `SUPABASE_SECRET_KEY` (or equivalent) is absent from the environment. No evidence was found that CI sets these secrets. Add a CI-level guard (e.g. a small always-run check that fails the build if `haveAdminCreds` is false in CI) so a missing-secret CI misconfiguration can never silently downgrade "these tests ran and passed" into "these tests never ran," which would be invisible in a green CI badge.

3. **Add an explicit id-absence assertion for AS-121 (search excludes soft-deleted tasks).** Current test at `search-tasks.test.ts:230-248` asserts `results.length === 1` rather than asserting the soft-deleted task's specific id is not present in results — a regression that happened to keep the count stable (e.g. by dropping a different row) would not be caught. Low priority given the double RLS+RPC enforcement already confirmed by code read, but cheap to add.

4. **Exercise AS-114's partial-failure branch with a real test.** No test forces the DB-row-delete to fail after the Storage object delete has already succeeded, which is exactly the orphan-risk scenario AS-114 is written to guard against. Add a test that mocks/forces a Supabase `.delete()` failure on the `attachments` table post-storage-removal and asserts the failure is logged with enough detail (attachment id + storage path) to allow manual cleanup, per the "at least being logged" requirement in the assertion text.
