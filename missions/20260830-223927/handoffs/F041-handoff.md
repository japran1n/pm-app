# Handoff: F041 — Fix AS-022: MUT-N wiring test + stale closure in use-calendar-realtime

## Status
COMPLETE

## Assertions covered
AS-022: PASS — reconciler unit tests, the new MUT-N-killing wiring test, and the DELETE/private-project tests in f027 all pass; verified the wiring test fails when visibleDateRange is manually mutated to undefined at the call site, then restored the source and re-ran green.

## Files changed
components/calendar/use-calendar-realtime.ts
tests/unit/f027-calendar-realtime-wiring.test.tsx
tests/unit/f040-calendar-realtime-date-scope.test.ts

## Commands run
`npx vitest run tests/unit/f027-calendar-realtime-wiring.test.tsx tests/unit/f040-calendar-realtime-date-scope.test.ts` (0)
`npx vitest run tests/unit -t "calendar"` (0) — 23 passed, 1476 skipped (grep-filtered run only executes tests whose full name contains "calendar"; all 10 calendar test files that matched passed)
`npm run lint` (0) — 0 errors, 13 pre-existing warnings unrelated to this change (chat/task-detail-sheet/palette test files)
`npx tsc --noEmit` (0)
`git commit` (0)

Mutant-kill verification (not a permanent artifact, done then reverted):
`sed -i 's/visibleDateRange,$/undefined,/' components/calendar/calendar-day-grid.tsx && npx vitest run tests/unit/f027-calendar-realtime-wiring.test.tsx` — new wiring test failed as expected (`expected undefined to deeply equal { start: '2026-09-01', end: '2026-09-05' }`); file restored from the `sed` backup before continuing, `git status` confirmed clean afterward.

## Decisions made
- **Stale closure fix**: added `onDueDateChange` (not `visibleDateRange` itself, which isn't in this hook's scope — it only receives the callback) to the `useEffect` deps array in `use-calendar-realtime.ts`. Since `calendar-day-grid.tsx` passes an inline arrow function as `onDueDateChange` that closes over `visibleDateRange`, that arrow gets a new identity on every render where `visibleDateRange` changes (i.e. on month navigation, since `days` — and therefore `visibleDateRange` — is a fresh prop from the server component on each `?month=` navigation). Adding it to deps means the effect re-subscribes (tears down the old channel, opens a new one) whenever the caller's closure changes identity, keeping the captured date window fresh. This does mean an extra unsubscribe/resubscribe cycle on every render where the inline callback's identity changes for unrelated reasons (e.g. `workspaceId`/`projectIds` prop changes) — acceptable since `acquireSharedTopicChannel` (F329) already ref-counts and dedupes per-topic channels, so this is not a new network cost per se, just more frequent ref-count churn. Removed the stale `eslint-disable-next-line react-hooks/exhaustive-deps` comment since the deps array is now actually exhaustive.
- **MUT-N wiring test approach**: DOM-only assertions couldn't distinguish the mutant (`visibleDateRange` → `undefined` at the call site) because `CalendarDayGrid` only ever renders the fixed `days` prop's cells — an out-of-window due_date can never produce a visible `<DayCell>` regardless of whether scoping ran, so an "insert an out-of-window task, assert it's not on screen" test would pass identically with or without the fix (this is exactly the vacuous pattern scrutiny flagged). Instead, spied on the real (un-mocked, `importActual`-wrapped) `reconcileCalendarRealtimeEvent` export via `vi.mock` + `vi.hoisted`, dispatched a normal in-window event, and asserted the reconciler's 4th call argument equals the range actually derivable from the test's own `days()` fixture (`{start: "2026-09-01", end: "2026-09-05"}`). This directly catches the argument being dropped/undefined at the call site independent of any individual event's outcome. Verified by manually reproducing the MUT-N mutation and confirming this new test (and only this test) goes red.
- **f040 4th test rewrite**: replaced the "documents the unscoped default in isolation" test (which pinned `undefined`'s behavior without ever comparing it to the scoped case, so it couldn't distinguish "scoping works" from "scoping was never wired") with a single test that runs the identical out-of-window INSERT through the reconciler twice — once with `visibleDateRange: undefined`, once with `RANGE` set — and asserts the two outcomes differ (admitted vs. ignored). This is non-vacuous: it fails if the `visibleDateRange` parameter were ever ignored inside the reconciler itself (both branches would then produce the same result).

## Out-of-scope work needed
None identified beyond what's already documented in `lib/calendar/reconcile-realtime-task.ts`'s own header comment (the pre-existing, unrelated "calendar has no filter-prop channel for status/priority/assigneeId/projectId" gap, and the "projectKey/projectName/assignees unresolvable from a bare realtime row" gap) — neither is part of AS-022 or this feature's scope.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to add `onDueDateChange` to the effect's dependency array rather than introducing a `useRef` for `visibleDateRange` inside `calendar-day-grid.tsx` (the alternative the spec mentioned as an option). The spec explicitly offered both options ("add `visibleDateRange` to its deps array (or use a ref for the range)"); the deps-array fix is strictly simpler (no new ref/effect-to-sync-the-ref plumbing needed in the caller), keeps the hook's existing "thin lifecycle wrapper" shape intact per its own header comment, and correctly captures ALL of the closure's captured variables (not just `visibleDateRange` — the same staleness class would apply to any other free variable a future caller's callback closes over), whereas a ref fix would only patch this one specific variable and reintroduce the same class of bug for the next closed-over value. The minor cost (re-subscribing more often than strictly necessary, e.g. on `workspaceId`-unrelated re-renders that happen to also produce a new closure identity) is absorbed by F329's existing shared-topic-channel ref-counting.

## Notes for the next worker
- Unrelated to this feature: `tests/unit/f038-as024-coverage.test.ts` is currently modified in the working tree (two new AS-024 tests around command-palette tombstone-map resets) from a prior session's uncommitted work — left untouched since it's outside F041's scope; the orchestrator may want to check whether that file's owning feature has a pending handoff/commit of its own.
- `missions/CURRENT`, `supabase/.temp/rest-version`, `supabase/.temp/storage-version` also show as modified in `git status` but were not touched by this worker and are not part of this commit.
- No MCP usage was needed for this feature — it's a pure client-side hook/component/test fix with no external service surface.
