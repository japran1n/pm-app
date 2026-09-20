# M4 Scrutiny — pass 1

_Mission 20260920-124226 · Milestone M4 "Tasks leave the Planner" (F015–F019)_
_Reviewed at HEAD `886de034` in a clean detached worktree. Read-only._

**VERDICT: RED — 3 FAILs (1 blocker, 2 major).**

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-033 | **FAIL** (major) | Planner renders no task chip today, but all three guarding tests mirror the deleted implementation, not the invariant. |
| AS-034 | **FAIL** (major) | Page issues no task query, but zero tests guard it; the only evidence is a worker's one-off grep. |
| AS-035 | PASS | `CalendarFilters` / `resolveCalendarFilters` have zero occurrences repo-wide; no renamed survivor renders on the route. |
| AS-036 | PASS | Stale params are unread and cannot throw; `weekHrefFor` rebuilds the query from scratch. |
| AS-037 | PASS | `task_id` gone from column, generated types, Zod schema, Server Action `SELECT_COLUMNS`, and form. |
| AS-040 | PASS | No mission commit touches My Tasks or any module it imports. |
| AS-080 | **FAIL** (major) | The three named files are genuinely deleted, but ~12 other live Planner-task tests were neither deleted nor skipped. |
| AS-081 | **FAIL** (blocker) | Ten task-fetching/task-filtering modules remain and are reachable from no route. `getCalendarTasks` has zero call sites anywhere. |

## What the code actually does

`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` accepts `searchParams: { week?: string }`,
resolves a week key (falling back to today on absent/invalid input), loads workspace
members, and streams `WeekGridSection`, which awaits exactly `getCalendarBlocks` and
`getTimeOffEntries` and renders `WeekView`. `WeekView` renders a header, an optional
time-off strip, `WeekTimeGrid` (desktop) and `WeekAgenda` (mobile). Neither accepts nor
renders anything task-shaped. The full transitive import closure of the page (43 modules)
touches the tables `workspaces`, `profiles`, `workspace_members`, `calendar_blocks`,
`time_off_entries` — and no `tasks`. There is no `useEffect`, `fetch(`, `channel(`, or
`subscribe` in the closure.

The removal itself is real. What is not real is the *containment* of the removal.

### AS-081 (blocker) — the month-view task subtree is still on disk

Every `components/calendar/*` module below is imported only by other modules in this list
or by tests. No `app/` route reaches any of them (the only `app/` imports from
`components/calendar/` are `week-view` at `calendar/page.tsx:38` and
`client-presentation-banner` at the workspace `layout.tsx:81`):

- `lib/queries/calendar.ts` — 359 lines. `getCalendarTasks:176` and `getUndatedTaskCount:258` have **zero call sites in the entire repo, tests included**. `CalendarTaskFilters:160` is the task-filter type F017 declined to remove. This is literally "unreachable task-fetching and task-filtering code".
- `components/calendar/month-grid.tsx`, `calendar-day-grid.tsx`, `agenda-list.tsx`, `day-cell.tsx`, `day-overflow.tsx`, `use-calendar-realtime.ts`
- `lib/calendar/reschedule.ts`, `lib/calendar/reconcile-realtime-task.ts`, `lib/tasks/subscribe-calendar-realtime.ts`

Explicitly **not** dead, exclude from any cleanup: `lib/calendar/month-grid.ts` (the date-math
module, imported by `app/(workspace)/w/[workspaceSlug]/time/me/page.tsx:68` and
`components/time/my-time-view.tsx:17`) and `lib/calendar/week-grid.ts`.

Three of these still render task chips linking to `/projects/<id>/board?taskId=<id>`
(`day-cell.tsx:190`, `agenda-list.tsx:116`, `day-overflow.tsx:62`). F019's handoff scoped
its AS-081 grep to `app/.../calendar/` only, which is why it reported clean. The assertion
says "on the Planner route", and these are the Planner's own components directory.

### AS-080 (major) — deletion was partial

Deleted, correctly and not skipped: `tests/integration/f232-calendar-query.test.ts`,
`f233-calendar-task-interactions.test.ts`, `f235-calendar-filters.test.ts`,
`tests/unit/f235-calendar-resolve-filters.test.ts`, `tests/e2e/f235-calendar-responsive.spec.ts`.
No `describe.skip`/`xit`/`todo` residue relating to Planner tasks — the only `.skip` hits
in `tests/` are pre-existing `skipIf(!haveAdminCreds)` env guards.

Still live, still asserting task behaviour inside the Planner, neither deleted nor skipped:
`tests/unit/f233-calendar-day-overflow.test.tsx` (its own header names the deleted
`f233-calendar-task-interactions.test.ts` as its integration counterpart),
`f235-calendar-responsive-render.test.tsx`, `f234-calendar-day-grid-wiring.test.ts`,
`f234-calendar-reschedule-plan.test.ts`, `f027-calendar-realtime-wiring.test.tsx`,
`f009-calendar-realtime-subscription.test.ts`, `f034-fix-realtime-bugs.test.ts`,
`f040-calendar-realtime-date-scope.test.ts`, `f326-month-grid-datakey-wiring.test.tsx`,
`f326-calendar-day-grid-rerender.test.tsx`, `f338-priority-a11y-contrast.test.tsx`,
`f009-workspace-status-options-project-scan.test.ts`, and
`tests/integration/f234-calendar-drag-reschedule.test.ts`.

AS-080 and AS-081 share one root cause: these surviving tests are the only thing keeping
the ten dead modules alive, and each side is being used to justify the other.

### AS-033 (major) — tests mirror the deleted implementation

`tests/unit/f015-remove-task-strips.test.tsx` has three cases:

- `:36-54` asserts `queryByTestId('calendar-week-allday-${day.date}')` is null. That testid exists nowhere in the repo, so the assertion is vacuously true and would stay true if a `calendar-week-task-chip-*` were added tomorrow. Zero regression value.
- `:56-77` asserts no rendered link's `href` contains `taskId=`. Catches only the *old* link shape; a task chip rendered as a `<div>`, or linking to `/tasks/<id>`, passes. It also renders a fixture with one block and no task data at all, so it cannot distinguish "tasks removed" from "no task data supplied".
- `:79-86` is the only case with teeth — a compile-time guard that `tasksByDate` is not in `ComponentProps<typeof WeekView>`. At runtime it is `expect(true).toBe(true)`; it bites only under `tsc --noEmit`, which the milestone gate does run. It guards one exact prop name.

A worker re-adding a task chip under any other name passes all three. The assertion holds
in the code; the tests confirm the implementation rather than the intent.

### AS-034 (major) — correct, entirely unguarded

No test imports `calendar/page.tsx`, greps its source, or mocks `@/lib/queries/calendar` to
assert `getCalendarTasks` is never called. A re-added fetch whose result is simply not
rendered would leave the whole suite green, including `f015-remove-task-strips.test.tsx`
(which covers markup, not fetching). The F016 handoff's evidence is a manual grep and a
compile — both evaporate on the next edit of the file.

Noted, not counted as a violation: loading the Planner *URL* does hit `tasks`, via the
shared workspace chrome — `app/(workspace)/w/[workspaceSlug]/layout.tsx:271` →
`getWorkspaceProjects` → `getOpenTaskCounts` (`lib/queries/projects.ts:106,138`) →
`rpc("get_open_task_counts")` for sidebar badges. That is pre-existing chrome on every
workspace route, not the Planner fetching its own tasks. Flagging so the UX validator
does not trip over it.

### AS-035 / AS-036 / AS-037 / AS-040 — passing, with caveats

- **AS-035 / AS-037 are unguarded by tests.** The two tests that mount `CalendarBlockPopoverForm` (`calendar-block-color-picker.test.tsx`, `calendar-block-client-presentation-toggle.test.tsx`) assert presence of the colour swatches and the toggle only; adding a task-link input leaves them green. AS-037 is nevertheless robust because `calendar_blocks.task_id` is dropped at the database level (`supabase/migrations/20261128010002_calendar_blocks_drop_task_id.sql`) and absent from the regenerated `lib/supabase/database.types.ts` — a re-added field cannot silently work. AS-035 is robust because the module is gone and `tsc` would catch a dangling import.
- **AS-036** relies on incidental behaviour: the page simply never reads the extra keys. One minor type lie — a duplicated `?week=a&week=b` makes `weekParam` a `string[]` at runtime while typed `string | undefined`; `WEEK_KEY_PATTERN.test()` coerces via `String()` and falls back safely, so no crash.
- **AS-040** is solidly verified. `git diff --name-only 3b92c53e~1 HEAD` touches no My Tasks file and no module the My Tasks page imports. The only shared file in the mission diff is `lib/supabase/database.types.ts`, whose entire diff is the removal of `calendar_blocks.task_id` and its two FK entries.

## Recommended follow-up features

**FU-1 (blocker, closes AS-081) — Delete the orphaned month-view task subtree.**
Remove `lib/queries/calendar.ts`, `components/calendar/month-grid.tsx`,
`calendar-day-grid.tsx`, `agenda-list.tsx`, `day-cell.tsx`, `day-overflow.tsx`,
`use-calendar-realtime.ts`, `lib/calendar/reschedule.ts`,
`lib/calendar/reconcile-realtime-task.ts`, and `lib/tasks/subscribe-calendar-realtime.ts`,
together with the tests that exist only to exercise them. Before deleting `lib/queries/calendar.ts`,
check its non-task exports for live consumers — `getWorkspaceStatusOptions` is imported by
`tests/unit/f009-workspace-status-options-project-scan.test.ts` and may have a home
elsewhere; relocate it rather than dropping it if any route needs it. Do **not** touch
`lib/calendar/month-grid.ts` or `lib/calendar/week-grid.ts`, which the My Time route depends
on. Gate: after deletion, `grep -rn "getCalendarTasks\|CalendarTaskFilters\|tasksByDate" app/ components/ lib/` returns zero, and `tsc`/`eslint`/`vitest` match the 41-file/133-test baseline.

**FU-2 (major, closes AS-080) — Retire the surviving Planner-task tests alongside FU-1.**
The thirteen test files listed above assert behaviour of components no route can reach.
They must be deleted, not skipped. `tests/integration/f234-calendar-drag-reschedule.test.ts`
needs a judgement call: it exercises the real `editTask` Server Action, which is still live
for My Tasks and the board — if its date-fidelity coverage is not duplicated by
`tests/integration/edit-task.test.ts`, move that coverage there rather than losing it.
Everything else deletes wholesale.

**FU-3 (major, closes AS-033 and AS-034) — Add falsifiable Planner-purity guards.**
Two tests that fail on reintroduction regardless of naming. First, a render test on
`WeekView` with realistic block and time-off fixtures that enumerates every `[data-testid]`
in the resulting tree and asserts each matches an allowlist of week-grid anchors — this
fails on any newly named task node, unlike the current testid-absence assertions. Second,
a source-level guard in the style this repo already uses in
`tests/unit/f234-calendar-day-grid-wiring.test.ts`: read `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
and the three `week-*.tsx` components and assert none imports from `@/lib/queries/calendar`
or `@/lib/queries/tasks`, and that the page's `searchParams` type still declares `week` only.
Replace the vacuous `calendar-week-allday-*` case in `f015-remove-task-strips.test.tsx`
rather than adding alongside it.

**FU-4 (minor, hardens AS-036) — Test the stale-param path.**
Render the Planner page with `searchParams` resolving to
`{week:"2026-06-01", status:"open", priority:"high", assigneeId:"x", projectId:"y"}` and assert
it renders the 2026-06-01 week without throwing, and that the prev/next hrefs carry `week=`
and nothing else. Include the duplicated-`?week=` array case, which currently type-lies.

## Gate output (clean worktree at `886de034`)

Run in `/private/tmp/.../wt-head`, a detached worktree at HEAD, with `node_modules` symlinked
and `.next/types` copied from the main checkout.

### `npx tsc --noEmit` → exit 0

```
(no output)
```

Note: the first run reported `app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.`
This is a worktree artefact, not a code defect — `tsconfig.json:29` includes `.next/types/**/*.ts`,
where Next.js generates `LayoutProps`. After copying `.next/types` into the worktree, tsc is clean.

### `npx eslint . --max-warnings=0` → exit 0

```
(no output)
```

### `npx vitest run tests/unit` → exit 1

```
 Test Files  41 failed | 469 passed | 1 skipped (511)
      Tests  133 failed | 3280 passed | 3 skipped (3416)
   Duration  86.24s
```

**Matches the recorded baseline exactly** (`run-log.md:19` — "41 test files failed, 133 tests
failed (PRE-EXISTING)" at baseline HEAD `3b92c53e`). M4 introduced no new failures.

Spot-check of failing suites for calendar/Planner involvement: the only failures whose names
mention "task" are `f024-section-card-details-data.test.tsx`, `f026-meta-bound-to-section.test.ts`
(architecture board `task_id`), and `f250-list-inline-edit.test.tsx` (list view). None is on the
calendar/Planner surface.
