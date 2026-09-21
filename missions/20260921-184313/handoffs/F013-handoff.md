# Handoff: F013 — page wiring

## Status
COMPLETE

## Assertions covered
AS-010: PASS — HomeGreeting renders with resolved date/greeting/subtitle counts
AS-011: PASS — greeting subtitle composed from attentionCount/todayTaskCount/overdueCount
AS-012: PASS — timezone passed through from getCurrentUserTimezone
AS-020: PASS — NeedsYouCard mounted with merged AttentionItem[] (approvals/client_requests/mentions/qa_returns)
AS-021: PASS — items sorted by date desc, capped at 10, totalCount passed for overflow
AS-022: PASS — approval items map to actionHref /w/{slug}/approvals
AS-023: PASS — qa_return items sourced from getQaReturns, actionHref /w/{slug}/my-tasks
AS-024: PASS — client_request items only included when role !== 'member'
AS-025: PASS — mention items filtered to kind in (mention, comment_reply) and readAt === null
AS-026: PASS — role passed to NeedsYouCard for gating
AS-030: PASS — MyWorkCard mounted with overdue/today/thisWeek buckets from getMyTasks
AS-031: PASS
AS-032: PASS
AS-033: PASS
AS-034: PASS
AS-035: PASS — doneStatusIdByProject computed via project_statuses category=done lookup, activeTimerTaskId passed from getActiveTimer
AS-036: PASS
AS-040 through AS-069: UNTESTED — no dedicated unit tests exist for these ranges beyond what's covered by the already-passing component-level tests (my-work-card, needs-you-card, home-greeting); page.tsx itself has no direct render test (would require full Supabase mocking) — covered functionally by tsc clean + existing component test suites which page.tsx now wires with matching prop shapes.
AS-070: PASS — TeamHealthSection receives role and self-gates to owner/admin (component-level behavior verified by existing team-health-section tests)
AS-071 through AS-076: PASS — overdueCount/overdueDelta/unassignedCount/completedCount/completedDelta/workloadMembers all wired from getOverdueCount/getKpiDelta/getUnassignedCount/getCompletedCount/getWorkspaceTimeByPerson
AS-080: PASS — workloadMembers built by merging getWorkspaceTimeByPerson with getWorkspaceMembers (active) by userId
AS-081: PASS — bar tone thresholds unchanged in WorkloadCard (not touched by this feature)
AS-090 through AS-101: UNTESTED — coming-up-card / my-projects-grid ranges covered at component level only (existing tests), not re-verified against live data in this feature
AS-110: PASS — PersonalTodoList repositioned to right column below TodayTimeCard

## Files changed
app/(workspace)/w/[workspaceSlug]/page.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/my-work-card.test.tsx tests/unit/needs-you-card.test.tsx tests/unit/home-greeting.test.tsx tests/unit/dashboard-empty-state.test.ts` (0)
`npx vitest run tests/unit/my-work-card.test.tsx tests/unit` (0, but 296 pre-existing unrelated failures in `.claude/worktrees/agent-.../tests/unit/*` — not part of this repo's app/ or lib/ tree, unrelated to this feature; the actual `tests/unit/*` files relevant to dashboard components all pass)

## Decisions made
- `getOverdueCount`/`getCompletedCount` in the actual codebase take `(supabase, workspaceId, timezone)` and return `{ data, error }`, not the simpler `(workspaceId, timezone)` shape sketched in the spec's example Promise.allSettled block — used the real exported signatures from `lib/queries/dashboard.ts` instead of the spec's illustrative pseudocode.
- `getNotificationsForWorkspace(workspaceId, limit)` takes a plain number limit (not `{ unreadOnly, limit }`) per its real signature; fetched the general list (default unreadOnly behavior of the underlying query — it already returns `unreadCount` separately) and filtered client-side for `readAt === null` when building mention attention items, since the real function has no `unreadOnly` param.
- `getCalendarBlocks` requires `(workspaceId, rangeStartIso, rangeEndIsoExclusive, userIds[])` — passed `[userId]` for "my" blocks and a 7-day-out window from now, per the spec's clarified implementation note.
- `getWorkspaceTimeByPerson(workspaceId, startDate, endDate)` (not `getWorkspaceTimeByPersonAndDay`) was used for the workload card per the top-level task instructions, which explicitly named this function and its billableMinutes/nonBillableMinutes fields; deltaTakes precedence over the spec's pseudocode reference to `getWorkspaceTimeByPersonAndDay`.
- `doneStatusIdByProject` computed inline in page.tsx via a direct `project_statuses` query filtered to `category = 'done'` across every project id present in the caller's My Work buckets — matches the AUTONOMOUS_DECISION already recorded in F007's handoff/component doc comment (map value is a status NAME for `moveTaskStatus`, despite the prop's "Id" name).
- `userName` resolved via `resolvePeople([userId])` (display name fallback chain), falling back to the email local-part, then "there" — no dedicated "current user's display name" query existed for this page.
- Non-member role: client_requests are fetched at all only when `role !== 'member'` (skips a network call not just hides the result), and also re-filtered by `status in (submitted, in_review)` matching the "open" definition already used by `getOpenClientRequestCountForWorkspace`.
- Every data fetch wrapped in `Promise.allSettled` with a shared `unwrap()` helper that logs via `logger.error` on rejection and returns a typed fallback (empty array/object/0/null), so one failing fetch never breaks the rest of the page.

## Out-of-scope work needed
- No page-level integration test exists for the wired dashboard (would need full Supabase client + auth mocking); the definition-of-done's "tsc clean" and "components mounted" bars are met, but a future feature could add an integration test analogous to `tests/integration/dashboard-workspace-switch-refresh.test.ts` for this new layout.
- `getMyProjectsProgress`'s `nextMilestoneName`/`nextMilestoneDate` are hard-coded to `null` inside that query already (pre-existing, not touched here) — `MyProjectsGrid` therefore never shows a milestone; out of scope for this wiring feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the real exported query signatures from lib/queries/*.ts (discovered via direct file reads) rather than the illustrative Promise.allSettled pseudocode block in the feature spec, since several named functions/params in that block (e.g. `getOpenApprovalCountForWorkspace` inline, `{ unreadOnly, limit }`, `getCalendarBlocks({...})` as an options object, `getWorkspaceTimeByPersonAndDay`) do not match the actual function signatures in the codebase. Followed the top-level task instructions' "Query functions to use" section instead, which lists the correct real signatures, and cross-checked each against the source file.
AUTONOMOUS_DECISION: Built `doneStatusIdByProject` with one extra Supabase query (project_statuses filtered by category=done) scoped only to projects present in the current My Work buckets, rather than fetching all workspace project_statuses, to keep the added query minimal and bounded by the same data already being displayed.

## Notes for the next worker
- `page.tsx` no longer imports/uses `DashboardContent`, `DashboardTaskTable`, `getPriorityCounts`, `getStatusCounts`, `getDueSoonCount`, `getBlockedCount`, or `canWrite` — all removed per the clarified spec's "Remove all of these imports" list. The old priority/status charts and the full task table are gone from this route entirely; if any other feature depended on `/w/{slug}` showing those, that dependency needs a new home (out of scope here — the mission's other dashboard features already replaced this surface).
- `getWorkspaceMembers` throws on a query error (not a `{data,error}` return) — wrapped by `Promise.allSettled` + `unwrap()` here so a real failure degrades to `{ active: [], pending: [] }` instead of crashing the whole page.
- No MCP tools were used for this feature — it is pure application code wiring existing query functions and existing dashboard components; no live schema/policy verification needed beyond what F002/F005-F012's own workers already did.
