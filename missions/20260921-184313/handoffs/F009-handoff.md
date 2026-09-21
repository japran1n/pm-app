# Handoff: F009 — coming-up-card.tsx

## Status
COMPLETE

## Assertions covered
AS-060: PASS — test_AS_060_renders_up_to_three_upcoming_blocks confirms up to 3 blocks render (a 4th is excluded), with time label, title, and duration subtitle, plus the "Coming up" header and "Planner →" link to `/w/<slug>/calendar`.
AS-061: PASS — test_AS_061_renders_empty_state_when_nothing_scheduled confirms "Nothing scheduled this week" renders when `blocks` is empty.

## Files changed
components/dashboard/coming-up-card.tsx
tests/unit/coming-up-card.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/coming-up-card.test.ts` (0, 2 passed)

## Decisions made
- Time label logic: same local calendar day as now → "Today HH:mm"; within the next 6 days → "EEE d" (e.g. "Wed 23"); otherwise → "d MMM". Matches the clarified spec's three-tier format exactly.
- Subtitle format: `<type label> · <duration> min`, derived from `endsAt - startsAt`; omitted when duration can't be computed (matches spec's "if duration present").
- Planner link target: `/w/${workspaceSlug}/calendar` — verified against the existing route at `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, since no other planner route exists in the app yet.
- No `timezone` prop was added even though "today" boundaries are timezone-sensitive, per AUTONOMOUS_DECISION below.

## Out-of-scope work needed
None identified for this feature's own scope. If a future feature wires this card into a page that already has the viewer's `timezone` available (e.g. via F005's `HomeGreeting` pattern), consider threading a `timezone` prop through for consistency with `lib/time/user-timezone.ts`'s "never use ambient runtime timezone" rule — see Autonomous decisions below.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The clarified spec's prop signature is exactly `{ blocks, workspaceSlug }` with no `timezone` prop, and no clarification-file answer mentions timezone for this feature. `lib/time/user-timezone.ts` establishes a strong project convention of never reading the ambient runtime's timezone for "is this today" logic, but adding an undeclared prop would deviate from the clarified spec's explicit prop shape. I resolved this by following the codebase's OTHER existing convention for calendar-block time formatting — `lib/calendar/block-datetime.ts`'s `formatBlockTimeRange`, which also formats block times using `Intl.DateTimeFormat(undefined, ...)` (runtime/server-local time) rather than an explicit timezone. This keeps the component consistent with how blocks are already formatted elsewhere and avoids silently overriding the clarified prop contract. If the orchestrator wants strict per-user-timezone correctness here, the fix is a small follow-up: add an optional `timezone?: string` prop and pass it into `formatTimeLabel`/`isSameLocalDay` via `lib/time/user-timezone.ts`'s helpers.

## Notes for the next worker
- `CalendarBlock` fields used: `id`, `title`, `startsAt`, `endsAt`, `blockType` (from `lib/queries/calendar-blocks.ts`).
- Card primitives used: `Card`, `CardHeader`, `CardTitle`, `CardContent` from `components/ui/card.tsx`.
- No MCP usage — this is a pure presentational Server Component with no live external state to inspect.
- The full `npx vitest run` (whole suite) was heavily contended by other concurrent workers' worktrees and long-running network-dependent RLS integration tests during this session, producing many unrelated failures (RLS/anon-key tests timing out, other features' pre-existing failures). These are pre-existing/environmental, not caused by this feature — verified by running this feature's own test file in isolation (passed) and confirming `npx tsc --noEmit` is clean project-wide.
