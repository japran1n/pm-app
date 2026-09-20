# M4 Scrutiny — Pass 2

Mission: 20260920-124226
Milestone: M4
Verdict: **NOT GREEN — 1 FAIL (AS-034, major)**
HEAD: 876b4800 `docs(F058): add handoff for surviving task-test retirement`

Follow-ups under review: F057 (delete orphaned task subtree), F058 (retire 13
surviving Planner-task tests), F059 (planner purity guards).

No code, test, or contract file was modified. All mutation testing was performed
in a throwaway detached `git worktree`, since removed.

## Assertion results

| ID | Status | Reason |
|----|--------|--------|
| AS-033 | PASS | Directed mutation caught; WeekView has no task prop and the calendar subtree renders zero task data. Guard is a regression lock, not an intent check — see major finding M2. |
| AS-034 | **FAIL** | Behaviour holds today, but the guard is a **blocklist of 2 module paths + 1 symbol name, not the import allowlist the follow-up claimed**. A one-line, tsc-valid import of a real existing task query into the Planner page leaves the guard green. Proof below. |
| AS-035 | PASS | `CalendarFilters` / `resolveCalendarFilters` / `calendar-filters` have zero occurrences repo-wide. `searchParams` on the Planner page is `{ week?: string }` only. No renamed survivor. |
| AS-036 | PASS | Stale `?status=` / `?priority=` / `?assigneeId=` / `?projectId=` keys are never destructured and cannot throw; navigation hrefs rebuild the query from scratch. Behaviour is correct but incidental (no test) — see minor finding M4. |
| AS-037 | PASS | `task_id` is absent from `calendar_blocks` at the DB level, from `lib/supabase/database.types.ts`, from the Zod schema, from the Server Action's `SELECT_COLUMNS`, and from the form. Zero `task` hits in `components/calendar/` outside comments. A re-added field cannot silently work. |
| AS-040 | PASS | `git log 3b92c53e~1..HEAD` touches no file under `app/(workspace)/w/[workspaceSlug]/my-tasks/` or `components/my-tasks/`. Last touch to My Tasks predates the mission. |
| AS-080 | PASS | All 13 listed test files verified absent from the working tree. No `.skip` / `xit` / commented-out survivors for Planner-task behaviour (the two remaining `describe.skipIf` hits are credential-gated RLS suites, unrelated). Date-fidelity coverage present in `tests/integration/edit-task.test.ts:331` and `:354`. See minor finding M5 on its executability. |
| AS-081 | PASS | `grep -rn "getCalendarTasks\|CalendarTaskFilters" app/ components/ lib/ --include="*.ts" --include="*.tsx"` returns **zero results**. `lib/queries/calendar.ts` is gone. `lib/calendar/month-grid.ts` mentions tasks only in prose comments and exports no task-fetching or task-filtering code; `week-grid.ts` imports only the `CALENDAR_WEEK_STARTS_ON` constant from it. |

Previously-failing assertions AS-080 and AS-081 are genuinely fixed. AS-033 is
fixed. AS-034 is not.

## Findings

### M1 — AS-034 guard is a blocklist, not an allowlist (blocker for GREEN, severity: major)

`tests/unit/f016-calendar-page-no-task-query.test.ts:24-30` defines:

```ts
const FORBIDDEN_STRINGS = [
  '"@/lib/queries/calendar"', "'@/lib/queries/calendar'",
  '"@/lib/queries/tasks"',    "'@/lib/queries/tasks'",
  "getCalendarTasks",
];
```

This asserts the absence of three specific spellings that the *deleted*
implementation happened to use. It does not assert that the Planner fetches no
tasks. The repo contains several other live modules exporting real task
fetchers that are not on the list: `lib/queries/my-tasks.ts`,
`lib/queries/task-activity.ts`, `lib/queries/task-types.ts`,
`lib/queries/portal/task-detail.ts`, `lib/queries/dashboard.ts`.

Mutation performed in an isolated worktree — inserted into
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`:

```ts
import { getMyTasks } from "@/lib/queries/my-tasks";
```

Result: `Test Files 1 passed (1) / Tests 21 passed (21)`. The Planner page
imports a real task query and the AS-034 guard stays green. No renaming, no
indirection, type-checks fine.

Other undetected paths confirmed by mutation and by import-graph trace:
a task fetch added to any calendar-subtree file outside the hardcoded four
(`add-block-popover.tsx`, `calendar-block-popover-form.tsx`,
`calendar-block-chip.tsx`, `time-off-day-strip.tsx`,
`client-presentation-banner.tsx`, `loading.tsx`, `error.tsx`,
`lib/actions/calendar-blocks.ts`, …); an inline `supabase.from("tasks")` in
`page.tsx`; a `supabase.rpc(...)`; a server action from `lib/actions/tasks.ts`.
The `searchParams` sub-check (`:47-70`) is likewise a five-literal blocklist —
`filterTask:`, `assignee:`, `t:` all pass.

The directed mutation from the review brief (re-adding a `getCalendarTasks`
import) **is** caught — 2 tests fail. That is the only shape the guard defends.

### M2 — AS-033 guard is a regression lock on the deleted markup (severity: major)

`tests/unit/f015-remove-task-strips.test.tsx` inspects only (a) `data-testid`
substrings `task` / `allday-chip` / `agenda-task`, (b) links whose `href`
contains `taskId=`, and (c) a compile-time check that `tasksByDate` is not a
`WeekView` prop.

Mutations run against `components/calendar/week-time-grid.tsx`:

| Mutation | Caught? |
|---|---|
| B1 — strip with `data-testid="calendar-task-strip"` | YES (1 failed) |
| B2 — chip with neutral testid but `href=".../board?taskId=t1"` | YES (1 failed) |
| B3 — chip with no testid, `href="/w/acme/projects/p1/board/t1"` | **NO (3 passed)** |
| B4 — plain `<div>` task strip, no testid, no link | **NO (3 passed)** |

Additional uncaught path from the import-graph review: tasks laundered through
the existing `blocks: CalendarBlock[]` prop by a server-side transform would
render as ordinary block chips and defeat all three tests, including the
`tasksByDate` type guard. Also uncovered: anything rendered inside the closed
popovers (`AddBlockPopover`, `calendar-block-popover-form`), and any
`useEffect`-fetched content (both tests assert on the synchronous first render
with no `findBy*`).

Graded PASS rather than FAIL because every surviving bypass requires either
deliberate non-task naming or a type-laundering transform, whereas the natural
regression shape — restoring the deleted code — is caught. The gap is real but
second-order relative to M1.

### M3 — Loading the Planner does issue a task query, via the workspace layout (severity: minor, scoping note)

`app/(workspace)/w/[workspaceSlug]/layout.tsx:271` calls `getWorkspaceProjects`,
which unconditionally calls `getOpenTaskCounts` →
`supabase.rpc("get_open_task_counts", { project_ids })`
(`lib/queries/projects.ts:106-109`, `:139-148`). That RPC aggregates over
`tasks`, and the result renders as `openTaskCount` per project in the sidebar.
A DB trace of a `/w/<slug>/calendar` page load therefore shows a tasks query.

Judged **out of scope** for this mission's AS-034: the sidebar is shared chrome
on every workspace route, is untouched by this mission, and is not "the
Planner". Note that the `AS-034` references in `lib/queries/projects.ts:4,15,54,131`
are a *different mission's* assertion ID (open task count) — an ID collision,
not evidence about this contract. Flagging so the orchestrator can rule
explicitly rather than leaving it latent.

### M4 — AS-036 has no test at all (severity: minor)

Correct by omission: the page never destructures the stale keys, so they cannot
throw. Nothing would fail if someone reintroduced a strict param parser.
Carried over unresolved from pass 1.

### M5 — The ported date-fidelity tests have never executed (severity: minor)

`tests/integration/edit-task.test.ts:331` and `:354` contain the two cases
ported from the deleted `f234-calendar-drag-reschedule.test.ts`
(`2026-01-31` month-end off-by-one; `2026-05-31` adjacent-month leading day).
They are structurally sound and type-check, but the whole integration suite
aborts in `beforeAll` with `fetch failed` — no network access to the live
Supabase project in this environment. AS-080 is about deletion, which is
satisfied, so this does not fail the assertion; but the ported coverage is
currently inert and unproven. Same limitation reported by the F057/F058/F059
workers.

### M6 — `tsc` in a clean worktree reports 1 error (severity: minor, environmental)

`app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.`
`LayoutProps<"/">` is a Next.js-generated global from `.next/types`, which does
not exist in a freshly-created worktree until a build runs. `npx tsc --noEmit`
in the main tree at HEAD exits **0 with zero output**. Not a code defect, but it
means "typecheck passes" is build-artifact-dependent and would fail on a cold CI
checkout that runs `tsc` before `next build`.

## Recommended follow-up features

**FU-1 (required for GREEN) — Convert the AS-034 guard from a blocklist to a
real allowlist.** Rewrite `tests/unit/f016-calendar-page-no-task-query.test.ts`
so it enumerates the Planner route's transitive import graph rather than four
hardcoded paths, and asserts against an explicit allowlist of permitted modules
instead of a denylist of forbidden strings. Starting from
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, resolve `@/`-prefixed
imports recursively across every file under `app/(workspace)/w/[workspaceSlug]/calendar/`,
`components/calendar/`, and `lib/calendar/`, and fail if any reached module path
matches `/task/i`, or if any reached source contains `from("tasks")`,
`from('tasks')`, or an `rpc(` call whose name matches `/task/i`. The allowlist of
non-task query modules (`calendar-blocks`, `time-off`, `profile`, `members`,
`auth/current-user`) should be spelled out so that adding a new data dependency
is a deliberate edit to the test. The test must fail on the exact mutation
documented in M1: a bare `import { getMyTasks } from "@/lib/queries/my-tasks";`
added to the Planner page. Extend the `searchParams` check the same way —
assert the type literal's key set equals exactly `{ week }` rather than
blocklisting five names.

**FU-2 (major, hardens AS-033) — Make the no-task-render guard structural rather
than anchor-based.** Strengthen `tests/unit/f015-remove-task-strips.test.tsx` so
it fails on task-shaped output regardless of naming. Assert on the rendered
tree's full text content and href set, not just `data-testid` substrings: no
anchor may point at any `/board`, `/t/`, or task-detail route shape; and the set
of distinct `data-testid` prefixes rendered by `WeekView` should be asserted
against an explicit expected list (`calendar-week-*`, `time-off-*`) so that ANY
new node type is a test failure requiring a deliberate update, closing mutations
B3 and B4. Add a case that opens `AddBlockPopover` and the block popover form and
asserts neither contains a task picker or "link to task" control, since the
current tests never render them. Verify by re-running all four mutations in M2.

**FU-3 (minor, closes AS-036) — Add a stale-param regression test.** A unit test
that invokes the Planner page's search-param handling with
`?week=2026-06-01&status=done&priority=high&assigneeId=u1&projectId=p1` plus a
duplicated `?week=a&week=b`, asserting the resolved week is correct and no throw
occurs. Locks in behaviour that is currently correct only by omission, and
covers the `string[]` runtime/type mismatch noted in pass 1.

**FU-4 (minor, closes M5) — Make the ported date-fidelity cases executable.**
Either provide the integration suite with credentials in CI, or add a pure-unit
companion in `tests/unit/` that exercises the date-only normalisation path
`editTask` uses for `dueDate` (month-end `2026-01-31` and `2026-05-31` under a
`TZ` west of UTC, e.g. `America/Los_Angeles`) without touching the network, so
the drag-reschedule off-by-one coverage actually runs somewhere.

**FU-5 (minor, closes M6) — Decide the `.next/types` dependency.** Either commit
a `types/next-globals.d.ts` shim declaring `LayoutProps`/`PageProps`, or make the
project's typecheck script run `next typegen` (or `next build --no-lint`) first,
so `tsc --noEmit` is green on a cold checkout.

---

## Command output

### `grep -rn "getCalendarTasks\|CalendarTaskFilters" app/ components/ lib/` (AS-081)

```
(zero results; exit 1)
```

### 13-file deletion check (AS-080)

```
check done
```
(no `STILL EXISTS:` lines — all 13 files absent)

Skip-survivor scan:
```
tests/integration/calendar-blocks-crud.test.ts:91:describe.skipIf(!haveAdminCreds)("Planner calendar_blocks CRUD + RLS", () => {
tests/integration/planner-block-rls.test.ts:59:describe.skipIf(!haveAdminCreds)("Planner calendar_blocks RLS (F011)", () => {
```
(credential-gated RLS suites, not Planner-task behaviour)

### `npx vitest run tests/unit/f015-remove-task-strips.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  2 passed (2)
      Tests  24 passed (24)
   Start at  15:37:26
   Duration  1.51s
```

### Mutation A — re-add `getCalendarTasks` import to calendar/page.tsx (AS-034 directed)

```
 × test_AS_034_app/(workspace)/w/[workspaceSlug]/calendar/page.tsx_does_not_reference__lib_queries_calendar_ 5ms
 × test_AS_034_app/(workspace)/w/[workspaceSlug]/calendar/page.tsx_does_not_reference_getCalendarTasks 1ms
 Test Files  1 failed (1)
      Tests  2 failed | 19 passed (21)
```
CAUGHT.

### Mutation C — task import in a calendar file outside the guard's 4-file list

```
 Test Files  1 passed (1)
      Tests  21 passed (21)
```
NOT CAUGHT.

### Mutation D2 — real task query imported into the Planner page

`import { getMyTasks } from "@/lib/queries/my-tasks";` added to `calendar/page.tsx`:
```
38:import { getMyTasks } from "@/lib/queries/my-tasks";
 Test Files  1 passed (1)
      Tests  21 passed (21)
```
NOT CAUGHT. — basis for the AS-034 FAIL.

### Mutations B1–B4 — task-shaped nodes injected into WeekView (AS-033 directed)

```
===== B1: obvious task strip with task-named testid =====
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
===== B2: task chip, neutral testid, but href has taskId= =====
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
===== B3: task chip, NO testid, link without taskId param =====
 Test Files  1 passed (1)
      Tests  3 passed (3)
===== B4: plain text task strip, no testid, no link =====
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### `npx vitest run tests/unit` (full unit suite)

```
 Test Files  41 failed | 458 passed | 1 skipped (500)
      Tests  133 failed | 3230 passed | 3 skipped (3366)
   Start at  15:37:57
   Duration  83.49s
```
Matches the 41/133 baseline exactly. No new failures, no improvement.

### `npx tsc --noEmit` — main tree at HEAD

```
main_tsc_exit=0
(0 lines of output)
```

### `npx tsc --noEmit` — clean detached worktree at HEAD

```
app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.
```
Build-artifact dependency (`.next/types` absent); see finding M6.

### `npx eslint . --max-warnings=0`

```
(no output, exit 0)
```

### Working tree after review

```
(no modifications to any code, test, or contract file; the mutation worktree was removed)
```
