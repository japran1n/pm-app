# Handoff: F073 — dashboard charts render

## Status
COMPLETE

## Assertions covered
AS-135: PASS — dashboard chart colors (PriorityBarChart, StatusPieChart) are sourced from lib/task-colors.ts's PRIORITY_COLORS/STATUS_COLORS, the same constant now used by the priority badge (components/task/task-card.tsx) and the board column header dot (components/board/board-column.tsx). Verified via tests/unit/dashboard-chart-colors.test.ts (3/3 passed).

## Files changed
lib/task-colors.ts (new — shared status/priority color-coding constant)
lib/queries/dashboard.ts (new — getPriorityCounts/getStatusCounts wrappers around F071/F072's RPCs)
components/dashboard/priority-bar-chart.tsx (new — client chart)
components/dashboard/status-pie-chart.tsx (new — client chart)
components/dashboard/dashboard-retry-button.tsx (new — client retry control for the error state)
app/(workspace)/w/[workspaceSlug]/page.tsx (replaced F014's placeholder with the two charts + loading/empty/error states)
app/(workspace)/w/[workspaceSlug]/loading.tsx (new — route-level Skeleton loading state)
components/task/task-card.tsx (retrofit: priority badge now uses PRIORITY_COLORS/PRIORITY_LABELS from lib/task-colors.ts instead of a local PRIORITY_LABELS copy; added a colored dot)
components/board/board-column.tsx (retrofit: column header now uses STATUS_COLORS/STATUS_LABELS from lib/task-colors.ts instead of a local COLUMN_LABELS copy; added a colored dot)
tests/unit/dashboard-chart-colors.test.ts (new)
package.json / package-lock.json (added recharts ^3.10.1)

## Commands run
`npm install recharts` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/unit/dashboard-chart-colors.test.ts` (0, 3/3 passed)
`npm test` (0, 71 files / 390 tests passed — full suite including this feature's tests)
`npm run build` (0)

## Decisions made
- No existing status/priority color-coding existed anywhere in the app before this feature — board columns rendered plain-text labels, and the priority badge used shadcn's neutral `variant="secondary"` with no per-value color. Per the spec's "extract a single shared color-mapping constant if one doesn't exist yet," created `lib/task-colors.ts` as that constant from scratch (STATUS_COLORS/STATUS_LABELS, PRIORITY_COLORS/PRIORITY_LABELS) rather than reverse-engineering colors from nothing.
- Retrofitted `task-card.tsx` and `board-column.tsx` to reference the shared constant instead of their own local label copies, per "retrofit existing badge/board color usage to reference the same constant ... if feasible without excessive scope creep." This was low-risk: both files already had a `Record<..., string>` label map with identical string values, so the retrofit is a drop-in replacement with no behavior change to rendered text, only the addition of a small colored dot. Verified no test asserts the absence of a color dot; existing board-column/task-card tests (label text, overdue treatment) still pass unchanged.
- Priority is nullable (per F071 handoff notes); added an explicit `"none"` bucket to PRIORITY_COLORS/PRIORITY_LABELS and to `getPriorityCounts`'s normalized output, rather than dropping null-priority tasks from the chart or crashing on a missing key.
- Both RPCs return sparse rows (a value with zero matching tasks gets no row, per F071/F072 handoff notes) — `lib/queries/dashboard.ts` normalizes into a dense array covering every fixed value, defaulted to count 0, so the chart components never index into a partial array.
- Server Component fetches both RPCs in parallel via `Promise.all` and awaits before render, keeping chart data in the initial HTML per the clarified spec's "Performance: primary content server-rendered in initial HTML (AS-155)." Recharts needs the DOM (ResizeObserver) to measure `<ResponsiveContainer>`, so only the two chart components are `"use client"` — the smallest possible client boundary, receiving pre-fetched data as a plain prop.
- Loading state implemented as a route-level `loading.tsx` (Next's automatic Suspense boundary around the page's own data fetching) rather than an in-page client-side loading state, so it satisfies the clarified spec's "loading (shadcn Skeleton)" requirement without contradicting AS-155 (once the Server Component resolves, chart data is still part of that response's HTML — loading.tsx only covers the request-in-flight window).
- Error state: on either RPC returning an error, logged via `console.error` (this codebase's existing Sentry-equivalent placeholder convention — see lib/actions/attachments.ts's own comment) and rendered as an inline message + a small Client Component retry button (`useRouter().refresh()`), rather than throwing and crashing the whole page.
- Empty state: computed from the status counts' total (0 across all four statuses) and rendered as an explicit message with a "View projects" next-action link, per the clarified spec's four-state requirement.
- Did not add a Playwright/E2E test — per the clarified spec's "Primary success test: appropriate to feature type ... unit test for pure logic," AS-135 is a pure data-to-color mapping concern, tested as a unit test against known RPC-shaped fixtures (not the live RPC, which F071/F072's own integration tests already cover).
- The new unit test can't use `renderToStaticMarkup` on the full chart tree: Recharts' `<ResponsiveContainer>` only measures/renders children in a real DOM with ResizeObserver, and this project's vitest environment is `"node"` (no jsdom) — a full render produces an empty shell. Instead, the test calls `PriorityBarChart`/`StatusPieChart` directly as functions (valid for a React function component: it returns the element tree without needing a renderer) and walks `.props.children` structurally (without invoking any Recharts-internal function component, since those use hooks that require an actual render pass) to find each `<Cell>` and assert its `fill` prop.

## Out-of-scope work needed
- AS-136 (dashboard data loads within the performance budget) is a separate assigned assertion not covered by this feature per the spec's assigned assertion list (only AS-135) — no explicit performance-budget test was added here.
- F074 (dashboard empty state), F075 (overdue count), F076 (workspace-switch refresh), F077 (RLS verification), F078 (dashboard table/filters) are separate features per the mission plan; this feature only covers the two charts.
- A `p_include_archived` toggle for the underlying RPCs (noted as out-of-scope by both F071 and F072) is still not built — not needed by AS-135.
- No Playwright/visual test verifies the charts render correctly in a real browser (e.g. actual pixel colors, responsive behavior) — the unit test verifies the data-to-color wiring at the component-prop level, which is what AS-135's own wording ("colors are consistent with ... color coding") calls for; a future E2E/visual-regression feature could extend this if the mission wants pixel-level verification.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose specific hex colors for STATUS_COLORS/PRIORITY_COLORS (slate/blue/amber/green for status; red/orange/yellow/blue/slate for priority) since no prior color-coding existed to match — picked for light/dark legibility and rough semantic convention (red = urgent, green = done). Documented directly in lib/task-colors.ts's comments so a future worker understands these are the source of truth, not an arbitrary/temporary choice.
AUTONOMOUS_DECISION: Retrofitted task-card.tsx and board-column.tsx rather than leaving them untouched, since the spec explicitly asked for this "if feasible without excessive scope creep" and the actual change was a same-shape drop-in (identical label strings, additive colored dot only) with all existing tests still passing unchanged.

## Notes for the next worker
- `lib/task-colors.ts` is now the single place to change a status/priority color — do not reintroduce a local color/label map elsewhere; import from here.
- `lib/queries/dashboard.ts`'s `getPriorityCounts`/`getStatusCounts` are the first app-level wrappers around F071/F072's RPCs; reuse them (rather than calling `.rpc(...)` directly) for any future dashboard feature (F074–F078) that needs the same normalized, dense, colored data shape.
- The empty-state check in page.tsx currently sums `statusData` only (every task has a status per F072's handoff notes, so this is a reliable "zero tasks" signal); if F074 builds a more elaborate empty state, it can reuse this same `totalTasks === 0` computation.
