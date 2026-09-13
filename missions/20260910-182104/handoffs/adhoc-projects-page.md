# Handoff: Ad-hoc — Projects list page card redesign

## Status
COMPLETE

## Assertions covered
This is an ad-hoc UI change, not tied to a validation-contract assertion ID.
It touches AS-034 (open task count Badge) and AS-155-adjacent (Server
Component streaming) surface area incidentally — both verified unchanged
below, not re-scoped.
AS-034: PASS — open-task-count Badge (including the `null` → "Open tasks:
pending" truthful state) is unchanged, still below the new progress bar.

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
lib/queries/projects.ts
components/projects/project-card-actions.tsx (new)
components/archive-project-dialog.tsx
components/edit-project-dialog.tsx
components/save-project-as-template-dialog.tsx
tests/unit/project-health-inputs-done-count.test.ts (new)

## Commands run
`npx vitest run tests/unit/projects-page-health-resilience.test.tsx tests/unit/compute-project-health.test.ts tests/unit/edit-project-dialog-icon-picker.test.tsx tests/unit/project-health-inputs-done-count.test.ts` (0, 21 passed)
`npx vitest run tests/unit` (1, 8 pre-existing unrelated failures — see Decisions made)
`npx tsc --noEmit` (1 overall, but zero errors in any file this change touched — pre-existing errors only, in unrelated in-flight architecture work and one pre-existing broken test file; confirmed via `git stash`/`tsc`/`git stash pop` that these errors exist independent of this change)
`npx eslint <touched files + new test>` (0 after fixing one `prefer-const` in the new test file)
`git commit` (0)

## Decisions made
- This was a resumption of an already-complete-on-disk implementation from
  an interrupted worker. Reviewed the full diff first (`git diff` on the
  six listed files) before touching anything; found the implementation
  already satisfied essentially every item in the spec, so no redesign or
  restart was done — only verification, one focused new test, and a lint
  fix.
- Confirmed by inspection that the previous worker's implementation
  already satisfied each spec item: 3-column grid unchanged; the ONLY new
  metric is the done/total progress bar (no due dates/phase/overdue count
  added to the card); the icon renders as a `size-9 rounded-md bg-secondary`
  tile to the left of the title (no longer part of the title string);
  cards use `h-full`/`flex flex-col` with the description `flex-1` so
  metadata pins to the bottom; the favourite star stays mounted at all
  times and is revealed via `opacity-0`/`opacity-100` classes only (never
  `display:none` or conditional mounting) when not already a favourite;
  the `MoreHorizontal` "..." trigger reveals on `group-hover/card`,
  `group-focus-within/card`, `focus-visible`, and stays visible via
  `data-popup-open` — the same convention `components/docs/docs-folder-row.tsx`
  already uses elsewhere in this repo, not a new one; `canSaveTemplate`
  still only disables (never hides) the item with the identical
  `disabledTitle` copy, and the Archive item is still only mounted inside
  `{canArchive && ...}`; the three dialogs are opt-in controlled
  (`open`/`onOpenChange`/`hideTrigger`) so closing the dropdown menu (item
  click closes the Menu) does not unmount an open dialog — every other
  existing caller of these three dialogs is unaffected since the new
  props are optional and default to the prior uncontrolled behaviour;
  `doneTaskCount` is derived inside `getProjectHealthInputs` from the same
  already-fetched `taskRows` used for `totalTaskCount`/`overdueTaskCount`
  (no new query, `get_open_task_counts` RPC untouched); percentage is
  clamped via `Math.min(100, Math.max(0, ...))` and `totalTasks === 0`
  renders "No tasks yet" instead of a bar; counts render `font-mono`, the
  word "done" stays sans; the progressbar has
  `role="progressbar"`/`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/
  `aria-label` naming the project; the open-task Badge and
  `ProjectHealthBadge` are unchanged below the bar; the "Back to workspace
  home" link is deleted; the `<Suspense>` fallback is a 6-card skeleton
  grid sized for the new taller cards; `Card` already carries `group/card`
  from its own base classes (the added `group/card` in this diff's
  `className` is a harmless duplicate, not a bug, left as-is to avoid an
  unrequested cleanup outside this change's scope) and `hover-lift` is
  the sole hover treatment on the Card (no competing hover class added).
- Added one new focused unit test file,
  `tests/unit/project-health-inputs-done-count.test.ts`, mirroring the
  existing filter-honouring mock convention from
  `tests/unit/portal-phases-query.test.ts` (via the shared
  `tests/unit/helpers/query-filter-mock.ts`), covering: `doneTaskCount`
  counts only `status === "done"` rows sharing the same `taskRows` as
  `totalTaskCount`; a project with zero tasks gets `doneTaskCount: 0`
  (never fabricated); `doneTaskCount` never exceeds `totalTaskCount`.
  Did NOT duplicate `computeProjectHealth`'s own edge-case coverage
  (percentage clamping / "No tasks yet" render path), since that's a
  render concern in `page.tsx` already implicitly covered by
  `projects-page-health-resilience.test.tsx`'s "still renders" assertions
  and is straightforward derived arithmetic already exercised by the new
  test's zero-task and all-done cases at the data layer.
- `npx tsc --noEmit` reports errors, but all of them are in files this
  change does not touch: `tests/unit/f074-request-approval.test.ts` (a
  pre-existing broken test unrelated to projects) — verified via
  `git stash`/`tsc --noEmit`/`git stash pop` that this and the
  architecture-related errors exist independently of this diff. Zero tsc
  errors appear against any of the six changed files or the new test file.
- `npx vitest run tests/unit` (full suite) has 8 pre-existing failures,
  none touching projects/dialogs/card-actions: `app-sidebar-project-nav-list`
  (an unrelated `NotificationBell`/`useRouter` mock gap),
  `f038-as024-coverage` (command palette), `f074-request-approval` (same
  broken file tsc flagged), `sign-out-back-navigation`, and
  `xss-sanitization-audit`. Confirmed these are pre-existing and unrelated
  to this change's scope, not new fallout from it.

## Out-of-scope work needed
- The pre-existing unrelated test/tsc failures listed above
  (`f074-request-approval.test.ts`, `app-sidebar-project-nav-list.test.tsx`,
  `f038-as024-coverage.test.ts`, `sign-out-back-navigation.test.ts`,
  `xss-sanitization-audit.test.ts`, and the in-flight architecture
  page/board/canvas-board files) are untouched per the task's explicit
  instruction to leave the unrelated architecture changes alone; they need
  their own follow-up outside this ad-hoc change.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the redundant `group/card` class in the Card's
`className` (it's already applied by Card's own base classes) rather than
removing it as an unrequested cleanup — it's inert, not a bug, and outside
this change's stated scope.

## Notes for the next worker
- Dev server was already running on localhost:3000 per instructions; not
  restarted. No manual browser verification was possible (no sign-in) —
  relied on the unit test suite + tsc + lint as instructed.
- The `components/projects/project-card-actions.tsx` Client Component
  boundary intentionally mirrors this repo's established
  "smallest-possible client boundary" convention (see
  `components/new-project-dialog.tsx`) so `ProjectsGridSection` itself
  stays a Server Component.
