# Mission 20260902-212300 — Plan

**Goal:** close the infrastructure and client-facing gaps left after mission
20260830-223927 — migration/publication drift detection, realtime channel
isolation, live + optimistic client portal, and the board's optimistic-move
race — without adding a dependency or a breaking change.

**Baseline commit:** `2db1bad`

---

## Milestones

| M | Theme | Features | Gate |
|---|---|---|---|
| M1 | Infrastructure guards & channel isolation | F001–F004 | AS-001–AS-011; guards runnable; `tsc` clean |
| M2 | Client portal: live + optimistic | F005–F009 | AS-012–AS-024; portal updates without reload |
| M3 | Board race & end-to-end proof | F010–F011 | AS-025–AS-030 |

Global gates AS-031–AS-034 are checked at every milestone boundary.

---

## M1 — Infrastructure guards & channel isolation

### F001 — Migration drift guard

**Milestone:** M1 · **Est:** 30 min · **Depends on:** none
**Assertions:** AS-001, AS-002, AS-003, AS-004

**Scope:**
- New `scripts/check-migration-drift.mjs`. Shells
  `npx supabase migration list --linked --output-format json`, parses the
  `migrations` array, and exits non-zero listing every entry with a falsy
  `remote`.
- Reads `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` from the environment;
  exits 1 with a plain message (no stack trace) when either is missing (AS-004).
- Must never print a credential value on any path (AS-003) — do not echo the
  spawned command line, do not dump `process.env` in error handlers.
- Add `"migrations:check": "node --env-file=.env scripts/check-migration-drift.mjs"`
  to `package.json`, matching the existing `db:apply` invocation style.
- Unit test with the subprocess mocked: a clean fixture exits 0, a fixture with
  one empty `remote` exits non-zero and names that version, a missing-env
  fixture exits 1 with the explanatory message, and no fixture's output contains
  a token value.

**Files:** `scripts/check-migration-drift.mjs`, `package.json`, new test.

**Note for the worker:** there is currently **no drift** — all 145 local
migrations have a remote counterpart. A first run that passes is the expected
outcome, not evidence the guard is broken.

---

### F002 — Realtime publication health verifier

**Milestone:** M1 · **Est:** 45 min · **Depends on:** F001 (script conventions)
**Assertions:** AS-005, AS-006

**Scope:**
- New `scripts/check-realtime-publication.mjs`. Scans `components/` and `lib/`
  for `postgres_changes` bindings and extracts each binding's `table:` value —
  discovery from source, never a hand-maintained list (AS-006).
- Queries the linked project for
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`
  using the Management API pattern already proven in
  `scripts/apply-migration.mjs` (`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`).
- Exits non-zero naming any subscribed table absent from the publication.
- Same credential-silence rule as F001.
- Add `"realtime:check"` to `package.json`.
- Unit test over the extraction function with fixture source strings, plus a
  test that a subscribed-but-unpublished table produces a non-zero result.

**Files:** `scripts/check-realtime-publication.mjs`, `package.json`, new test.

**Note:** at baseline this verifier is expected to FAIL on `client_requests`
once F007 adds that subscription — F006 adds it to the publication first, so
the ordering matters.

---

### F003 — Split My Tasks realtime onto two channels

**Milestone:** M1 · **Est:** 40 min · **Depends on:** none
**Assertions:** AS-007, AS-008, AS-009, AS-010, AS-011

**Scope:**
- `components/my-tasks/use-my-tasks-realtime.ts`: replace the single
  `acquireSharedTopicChannel` call carrying two `postgres_changes` bindings with
  two calls, topics `tasks:my-tasks:<userId>:assignees` and
  `tasks:my-tasks:<userId>:tasks`.
- The `trackedTaskIds` `Set` is passed to both handlers by reference so the
  cross-channel invariant holds (AS-011).
- `subscribeToMyTasksRealtime` returns one unsubscribe that releases both
  (AS-010).
- Public signature of `subscribeToMyTasksRealtime` and `useMyTasksRealtime`
  is unchanged — existing callers and tests must keep compiling.
- Tests: a dead assignees channel still delivers `tasks` updates (AS-008); a
  dead tasks channel still delivers assignment events (AS-009); unsubscribe
  releases both.

**Files:** `components/my-tasks/use-my-tasks-realtime.ts`, its test file.

---

### F004 — M1 wiring regression tests

**Milestone:** M1 · **Est:** 25 min · **Depends on:** F003
**Assertions:** AS-007, AS-010, AS-031, AS-032, AS-033

**Scope:**
- Assert the two-channel topology from the outside: the number of distinct
  topics acquired, and that each topic carries exactly one binding.
- Confirm no existing My Tasks test regressed as a result of F003.

**Files:** `components/my-tasks/*.test.ts(x)`.

---

## M2 — Client portal: live + optimistic

### F005 — Optimistic portal approve

**Milestone:** M2 · **Est:** 40 min · **Depends on:** none
**Assertions:** AS-012, AS-013, AS-014, AS-015

**Scope:**
- `components/portal/approval-actions.tsx`: replace the bare `useTransition` +
  `await approvePortalTask` + `router.refresh()` sequence with an optimistic
  apply. Reuse `lib/hooks/use-optimistic-action.ts` if its `T`-valued shape
  fits; otherwise follow the same structure locally rather than widening the
  shared hook's contract.
- `approvePortalTask` returns `{ ok: false, error }` on failure and can also
  throw — both paths must revert and toast (AS-013, AS-014).
- In-flight guard so a second click issues no second call (AS-015). Use a ref,
  not `isPending` alone, since `isPending` lags a synchronous double-click.
- Keep `router.refresh()` on success for server-truth reconciliation.

**Files:** `components/portal/approval-actions.tsx`, new test file.

---

### F006 — Add `client_requests` to the realtime publication

**Milestone:** M2 · **Est:** 20 min · **Depends on:** none
**Assertions:** AS-017

**Scope:**
- New migration `supabase/migrations/<ts>_client_requests_realtime_publication.sql`,
  modelled on `20260831000001_task_assignees_realtime_publication.sql`.
- Idempotent: guard the `alter publication ... add table` so re-running is safe.
- Do NOT change replica identity — F042 of the previous mission reverted exactly
  that on `task_assignees`; the same reasoning applies here.
- The worker applies it with `npm run db:apply -- <file>` and confirms
  membership by re-querying `pg_publication_tables`.

**Files:** one new migration.

---

### F007 — Portal realtime reconciler

**Milestone:** M2 · **Est:** 45 min · **Depends on:** F006
**Assertions:** AS-020, AS-024

**Scope:**
- New `lib/portal/reconcile-portal-realtime-task.ts`, in the shape of
  `lib/tasks/reconcile-list-realtime-task.ts`.
- Membership predicate: `client_visible === true && deleted_at == null`, plus a
  caller-supplied per-surface predicate (e.g. `pending_client_approval === true`
  for "Waiting on you").
- A row that fails the predicate is removed from the list, whether it arrived as
  an UPDATE or a DELETE (AS-020).
- Pure function, fully unit tested, no Supabase import.

**Files:** `lib/portal/reconcile-portal-realtime-task.ts`, its test.

---

### F008 — Portal overview live

**Milestone:** M2 · **Est:** 50 min · **Depends on:** F007
**Assertions:** AS-018, AS-019, AS-020, AS-024

**Scope:**
- Extract "Waiting on you" and "Delivered this week" out of the RSC
  `app/(portal)/portal/[workspaceSlug]/page.tsx` into a client component seeded
  by server props. The page stays an RSC and keeps its RLS-scoped queries.
- Subscribe to `tasks` via `acquireSharedTopicChannel`, reconcile with F007's
  function, one channel per table.
- Teardown on unmount (AS-024).

**Files:** `app/(portal)/portal/[workspaceSlug]/page.tsx`, new
`components/portal/portal-overview-live.tsx` (or similar), new test.

---

### F009 — Portal project page and requests live

**Milestone:** M2 · **Est:** 50 min · **Depends on:** F006, F007
**Assertions:** AS-021, AS-022, AS-023, AS-024

**Scope:**
- `components/portal/task-list.tsx`: subscribe to `tasks`, reconcile via F007 —
  status/title updates land live (AS-021), deletes and
  `client_visible → false` remove the row (AS-022).
- `components/portal/request-list.tsx`: subscribe to `client_requests`, insert
  and status-change land live (AS-023).
- Both seeded by their existing server props; both tear down on unmount.

**Files:** `components/portal/task-list.tsx`,
`components/portal/request-list.tsx`, tests for both.

---

## M3 — Board race & end-to-end proof

### F010 — Board optimistic-move / realtime-echo guard

**Milestone:** M3 · **Est:** 50 min · **Depends on:** none
**Assertions:** AS-025, AS-026, AS-027, AS-028

**Scope:**
- `components/board/board.tsx` already guards optimistic **creates** with
  `pendingOptimisticCreatesRef`. Add the equivalent for **moves**: a
  `pendingMovesRef` holding task ids whose drag Server Action is in flight.
- The realtime reconciliation callback skips `tasks` UPDATE events for an id in
  that set (AS-025).
- The id is released in every terminal path — success, `{ ok: false }`, throw,
  and the `rollback()` helper (AS-026, AS-027). A release that only happens on
  success is the bug this feature exists to prevent.
- Events for ids not in the set are unaffected (AS-028).
- Tests must be discriminating: a mutant that never populates the set, and a
  mutant that never releases it, must both fail.

**Files:** `components/board/board.tsx`, board test file.

---

### F011 — Portal end-to-end spec

**Milestone:** M3 · **Est:** 60 min · **Depends on:** F005, F008
**Assertions:** AS-029, AS-030

**Scope:**
- New `tests/e2e/portal-approve.spec.ts` following the auth and fixture
  conventions already used in `tests/e2e/` (see `notifications.spec.ts` and
  `f272-two-context-notifications.spec.ts` for the two-context pattern).
- Path: sign in as a client → open the portal overview → assert a task is listed
  under "Waiting on you" → click Approve → assert the row leaves the section
  **without a page reload** (assert on absence of a navigation event, not just
  on the final DOM).
- Creates its own fixture task and tears it down (AS-030).
- If no client-role E2E fixture exists, this feature creates one.

**Files:** `tests/e2e/portal-approve.spec.ts`, fixture helper if needed.

---

## Ordering

```
F001 → F002
F003 → F004
F006 → F007 → F008 → F009
F005 (independent)
F010 (independent)
F005 + F008 → F011
```

M1: F001, F002, F003, F004
M2: F005, F006, F007, F008, F009
M3: F010, F011
