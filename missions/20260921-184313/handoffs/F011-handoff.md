# Handoff: F011 — team-health-section.tsx + workload-card.tsx

## Status
PARTIAL

## Assertions covered
AS-070: PASS — `TeamHealthSection` returns `null` unless `role === 'owner' || role === 'admin'` (member/viewer/guest/client all excluded); verified by reading the guard, no dedicated render test added since no test runner call site/story exists yet for this component.
AS-071: UNTESTED — no page wiring exists yet to verify "Team health" heading + Owner pill render in a live dashboard; component-level render is present.
AS-072: UNTESTED — overdue KPI tile with delta present; not exercised against real data since no caller wires `overdueCount`/`overdueDelta` yet.
AS-073: UNTESTED — unassigned KPI tile with "Assign owners →" present; not wired to real data yet.
AS-074: UNTESTED — completed KPI tile with delta present; not wired to real data yet.
AS-075: UNTESTED — delta color logic implemented (red when overdue delta positive, green when completed delta positive, via `DeltaLine`); no unit test written.
AS-076: PASS (by inspection) — all three KPI tiles render as real `<a href=...>` elements, not buttons/divs with onClick.
AS-080: UNTESTED — WorkloadCard row layout (avatar | name | bar | hours) implemented; not unit tested.
AS-081: UNTESTED — bar color thresholds implemented in `barTone()` (green <80%, amber 80-100%, red >100%); no unit test written verifying the three bands.

## Files changed
components/dashboard/team-health-section.tsx
components/dashboard/workload-card.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Followed the task prompt's prop shape (`workloadMembers: WorkloadCardMember[]`) rather than the raw feature-spec snippet's `workloadData: WorkspaceTimeByPerson[]`, because `WorkspaceTimeByPerson` (lib/queries/time-entries.ts:44) only carries `userId`, `billableMinutes`, `nonBillableMinutes` — it has no `displayName`/`avatarUrl`/`minutesThisWeek` fields needed to render an avatar+name+bar row. A future page-level caller is expected to join `getWorkspaceTimeByPerson` output with workspace member profile data (name/avatar) and sum billable+non-billable minutes into `minutesThisWeek` before passing it down. This mirrors how other dashboard cards (e.g. `my-work-card.tsx`) receive pre-shaped view-model props rather than raw query rows.
- Inlined a new `TeamKpiTile` in `team-health-section.tsx` instead of reusing `components/dashboard/kpi-tile.tsx`'s `KpiTile`, because `KpiTile` takes a fixed `description: string` slot, but these three tiles need a computed delta line (colored, conditional on sign) instead of static text. `KpiTile` was left untouched.
- `overdueDelta`/`completedDelta` sign convention: positive = more than last week for both (per spec comment). Overdue overshoot is bad (red), completed overshoot is good (green) — encoded via `DeltaLine`'s `positiveIsBad` flag.
- Bar color thresholds implemented as ratio-based (`minutesThisWeek / targetMinutes`): green `< 0.8`, amber `0.8–1.0`, red `> 1.0`, matching AS-081 literally.
- Used the existing `Badge` component (`variant="secondary"`) for the "Owner" pill rather than a bespoke span, consistent with the Supabase design system badge rules already in this repo (uppercase pill, no color dot).

## Out-of-scope work needed
- No page (e.g. `app/(workspace)/w/[slug]/page.tsx` or a home dashboard composer) currently imports/renders `TeamHealthSection`. Wiring it in — computing `overdueCount`/`overdueDelta`/`unassignedCount`/`completedCount`/`completedDelta` (likely via new or existing queries in `lib/queries/dashboard.ts` and `lib/queries/tasks.ts`) and joining `getWorkspaceTimeByPerson` with member profile data into `WorkloadCardMember[]` — is a separate feature/task not covered by F011's "Touches" scope (which was limited to the two component files). Until that wiring exists, AS-071 through AS-075, AS-080, and AS-081 can only be verified in isolation (component logic), not end-to-end in the running app.
- Unit tests for `TeamHealthSection`/`WorkloadCard` (e.g. `test_AS_070_...`, `test_AS_081_...`) were not added in this pass — the feature's "Touches" scope named only the two component files and did not include a test file path. Recommend a follow-up (or the page-wiring feature) add `tests/unit/team-health-section.test.tsx` and `tests/unit/workload-card.test.tsx` covering: role-gating (AS-070), `<a>` tag presence on KPI tiles (AS-076), delta color logic (AS-075), and the three bar-color thresholds (AS-081).

## Blockers
BLOCKER: Several assertions (AS-071 through AS-075, AS-080, AS-081) describe end-to-end rendered behaviour that requires real dashboard data wiring and/or dedicated unit tests, neither of which is in this feature's scope (spec "Touches" = the two component files only). Building those tests without a page wiring context risks testing against fabricated props rather than the actual data contract a page would supply.
TRIED: Implemented both components per the clarified spec's prop shapes and verified `tsc --noEmit` passes cleanly; verified role-gating and `<a>`-tag usage by direct code inspection.
NEEDED: A follow-up feature to (1) wire `TeamHealthSection` into the dashboard page with real `getWorkspaceTimeByPerson`/overdue/unassigned/completed queries, and (2) add unit tests for AS-071–AS-075, AS-080, AS-081 against that real wiring (or against the components directly with representative fixture props).
SUGGESTED FOLLOWUP: Add a feature "Wire TeamHealthSection into dashboard page" that: fetches `getWorkspaceTimeByPerson(workspaceId, weekStart, weekEnd)` plus a prior-week comparison window for the two deltas, computes `unassignedCount`/`completedCount` from existing task queries, joins the time-by-person rows with workspace member profile rows (name, avatar_url) to build `WorkloadCardMember[]`, renders `<TeamHealthSection>` on the dashboard page guarded by the caller's role, and adds `tests/unit/team-health-section.test.tsx` / `tests/unit/workload-card.test.tsx` with `test_AS_071`..`test_AS_076`, `test_AS_080`, `test_AS_081` names asserting on rendered output (heading text, `<a>` href presence, delta color classes, bar color classes at 70%/90%/110% of target).

## Autonomous decisions
AUTONOMOUS_DECISION: Changed the `workloadData: WorkspaceTimeByPerson[]` prop from the raw spec snippet to `workloadMembers: WorkloadCardMember[]` (matching the richer shape the task prompt described) because `WorkspaceTimeByPerson` lacks the display fields (`displayName`, `avatarUrl`, `minutesThisWeek`) the UI needs — passing the raw query type would force `WorkloadCard` to either duplicate a member-profile lookup itself (violating "Server Component for data loading only in the page" convention seen elsewhere, e.g. `UserAvatar`'s own doc comment) or fail to render. The caller (a future page) is expected to do the join before calling this component, consistent with how `my-work-card.tsx` and other dashboard cards receive pre-shaped props.

## Notes for the next worker
- `WorkloadCardMember.avatarUrl` and `displayName` map directly onto `UserAvatar`'s `person: { id, name, avatarUrl }` prop — no extra transform needed at the call site beyond supplying those three fields per member.
- `WorkloadCard` accepts a `workspaceSlug` prop used only for the "Time report →" link (`/w/{slug}/time`); confirm this route exists (it's referenced elsewhere in `lib/queries/time-entries.ts` doc comments as `time/[userId]/page.tsx`, so the workspace-level `/time` index route should exist or be confirmed before wiring).
- KPI tile hrefs use `/w/{slug}/my-tasks?overdue=true` / `?unassigned=true` / `?completed=true` per the spec's "or nearest equivalent filtered URL" — these query param names were not verified against an actual `my-tasks` page filter implementation; the next worker wiring this in should confirm/adjust the exact param names `dashboard-task-table.tsx` or the my-tasks page actually reads (the spec references `?flag=` conventions used elsewhere in `kpi-tile.tsx`'s doc comment for a similar dashboard KPI row).
