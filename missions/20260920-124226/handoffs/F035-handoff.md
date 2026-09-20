# Handoff: F035 — stacked row reorder

## Status
PARTIAL

## Assertions covered
AS-064: PASS — `StackedPlanner` wraps rows in `DndContext`/`SortableContext` with a per-row drag handle; verified via `tests/unit/f035-stacked-reorder.test.tsx` (captured `onDragEnd` invoked directly, since jsdom has no real pointer/drag simulation — same pattern as `tests/unit/f024-drag-cancellation.test.tsx`).
AS-065: PASS — dragging a row computes the new order and calls `router.replace` with `?people=` serialized via `serializePeopleParam(newOrder, selfId)`; a no-op drag (`active.id === over.id`) does not call `router.replace`. Verified in the same test file.

## Files changed
- components/calendar/stacked-planner.tsx (now `"use client"`; wraps rows in dnd-kit `DndContext`/`SortableContext`, adds `SortableRow` drag-handle wrapper, `handleDragEnd` computing new order and calling `router.replace(...?people=...)`)
- tests/unit/f035-stacked-reorder.test.tsx (new — AS-064/AS-065 coverage)
- tests/unit/f032-stacked-shell.test.tsx (added `vi.mock("next/navigation")` — StackedPlanner is now a client component that calls `useRouter`, so this shell test needs a router in scope even though it never triggers a drag)

## Commands run
`npx tsc --noEmit` — my two files (`stacked-planner.tsx`, `f035-stacked-reorder.test.tsx`) produce zero errors when the pre-existing/concurrent breakage is filtered out (see Blockers); full-repo `tsc --noEmit` currently fails (22 errors, all in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, `components/calendar/week-view.tsx`, and tests that render `WeekView` — none of these errors reference `stacked-planner.tsx` or `f035-stacked-reorder.test.tsx`)
`npx eslint components/calendar/stacked-planner.tsx tests/unit/f035-stacked-reorder.test.tsx tests/unit/f032-stacked-shell.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f035-stacked-reorder.test.tsx tests/unit/f032-stacked-shell.test.tsx` (0, 6/6 passed)

## Decisions made
- Made `workspaceSlug` and `selfId` optional props on `StackedPlanner` (rather than required) so callers/tests that don't wire reorder persistence keep compiling and passing without changes — `handleDragEnd` simply no-ops (doesn't persist) if either is missing.
- Used `router.replace` (not `push`) on reorder, per the feature spec note that this shouldn't pile up history entries the way week/people navigation does.
- Drag handle is a small `GripVertical` icon button (`aria-label="Drag to reorder"`) rather than making the whole row draggable, so the row's own interactive content (if any is added later) isn't swallowed by drag listeners.
- Test technique: captured the `onDragEnd` callback passed to `@dnd-kit/core`'s `DndContext` via `vi.mock("@dnd-kit/core")` and invoked it directly with a synthetic `{ active, over }` event, mirroring the exact pattern already used in `tests/unit/f024-drag-cancellation.test.tsx` (jsdom has no real pointer/drag simulation).
- Did NOT wire `workspaceSlug`/`selfId`/`weekParam` into the `<StackedPlanner>` call site in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` — see Blockers. The component works correctly once wired; wiring is a 3-line prop addition at the `<StackedPlanner ... />` call inside `WeekGridSection`'s `layout === "stacked"` branch.

## Out-of-scope work needed
- Wiring `workspaceSlug={workspaceSlug} selfId={currentUserId} weekParam={weekParam}` onto the `<StackedPlanner>` call site in `page.tsx` once F088's in-flight refactor of that file lands (see Blockers below) — without this wiring, the stacked layout's rows are visually draggable but reorder is not persisted to the URL in production, only in tests that pass the props directly.

## Blockers
BLOCKER: `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` (and `components/calendar/week-view.tsx`) are mid-edit by what appears to be a concurrent/uncommitted F088 (Planner header) refactor — the working tree for these files changed under me multiple times during this session (confirmed via `git status`/`git diff` showing uncommitted modifications not authored by me, and `git log` showing no commit for them). The refactor is currently broken (repo-wide `tsc --noEmit` reports 22 errors: `formatWeekRangeLabel` not exported from `lib/calendar/week-grid`, `weekParam`/`prevHref`/`nextHref`/`todayHref` referenced but no longer in scope in `page.tsx`, and several tests passing now-removed `WeekView` props).
TRIED: Added my 3-prop wiring (`workspaceSlug`/`selfId`/`weekParam`) to the `<StackedPlanner>` call site twice; both times the surrounding file was rewritten again before I could verify/commit it, and a `git stash`/`git stash pop` round-trip to recover my own edit after the first overwrite hit a merge conflict against the (also-changing) file. I stopped touching `page.tsx` entirely after recovering my own `stacked-planner.tsx`/test changes, to avoid corrupting whatever the other process is mid-writing, and committed only the files exclusively scoped to F035.
NEEDED: Orchestrator should confirm F088 has fully landed/committed (or is not actually running concurrently — if it's genuinely a stale/interrupted worker's uncommitted tree, someone needs to either finish or revert it) before a follow-up worker adds the 3-line `<StackedPlanner workspaceSlug=... selfId=... weekParam=... />` wiring in `page.tsx`.
SUGGESTED FOLLOWUP: Once `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` is stable (F088 committed or reverted), add a small feature/task to pass `workspaceSlug={workspaceSlug}`, `selfId={currentUserId}`, and `weekParam={weekParam}` to the `<StackedPlanner>` call inside `WeekGridSection`'s `layout === "stacked"` branch, then re-run the full `npx tsc --noEmit` / `npx eslint . --max-warnings=0` / full vitest suite to confirm the whole repo (not just F035's own files) is green.

## Autonomous decisions
AUTONOMOUS_DECISION: Left `workspaceSlug`/`selfId` optional on `StackedPlanner` (default: reorder persistence no-ops) rather than blocking on wiring `page.tsx`, so the component itself is fully correct, tested, and mergeable independent of the F088 collision described above.

## Notes for the next worker
- `components/calendar/stacked-planner.tsx` and `tests/unit/f035-stacked-reorder.test.tsx` are self-contained and pass `tsc`/`eslint`/`vitest` in isolation — the only remaining work for AS-064/AS-065 to be user-visible in production is the 3-line prop wiring in `page.tsx` described above.
- If `git status` still shows `page.tsx` / `week-view.tsx` / `components/calendar/planner-header.tsx` (untracked) as dirty when you pick this up, treat that as F088's in-progress state, not mine — I never modified `week-view.tsx` or `planner-header.tsx` at all.
- No MCP tools were used — this is a pure client-side UI feature (dnd-kit + URL param), no external service or live schema involved, per `worker-mcp-usage`'s decision tree ("Pure UI feature → No MCP").
