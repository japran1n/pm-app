# Handoff: F008 — Four-item portal sidebar

## Status
COMPLETE

## Assertions covered
AS-014: PASS — `buildPortalNavItems` now returns exactly Home (exact match), For you, Messages; `buildPortalProjectNavItems` returns the Project group's children (Pages, Site map, Your site, Scope & decisions, Results, Hours [hourly only], Questionnaire, How we work), Hours gated on `billingModel === "hourly"`. Covered by `components/portal/portal-sidebar.test.tsx` (`test_AS_014_*`, 9 tests) and the mobile/desktop rendering tests.
AS-015: PASS — Results (`${basePath}/results`) and Questionnaire (`${basePath}/brief`) are both children of the Project group, reachable from the sidebar (previously only Results was in the flat list and brief had no nav entry at all). Covered by `test_AS_015_results_and_questionnaire_are_reachable_from_the_project_group`.
AS-016: PASS — the Project group auto-expands (and stays expanded, non-collapsible) while `usePathname()` matches any child href, including nested routes (`/pages/<id>`), and the active child gets `aria-current="page"`; collapsed by default off any child route. Covered by `test_AS_016_*` (3 tests, incl. a nested-route case).

## Files changed
components/portal/portal-sidebar.tsx
components/portal/portal-sidebar.test.tsx
components/portal/portal-topbar.tsx
components/portal/portal-topbar.test.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx
tests/unit/f039-portal-guards.test.ts

## Commands run
`npx vitest run components/portal/portal-sidebar.test.tsx components/portal/portal-topbar.test.tsx` (0 — 40/40 passing)
`npx vitest run tests/unit/f039-portal-guards.test.ts` (0 — 4/4 passing)
`npx vitest run tests/integration/f003b-relocate-portal-routes.test.ts` (0 — 12/12 passing)
`npx tsc --noEmit` (0 — clean)
`npx eslint components/portal/portal-sidebar.tsx components/portal/portal-sidebar.test.tsx components/portal/portal-topbar.tsx components/portal/portal-topbar.test.tsx "app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx"` (0 — clean)
`npx vitest run tests/unit components/portal lib/portal` (5 files / 6 tests failed — all pre-existing `cookies() called outside a request scope` failures in unrelated custom-fields/task-detail-sheet tests, same class F006/F007's own handoffs already documented; nothing referencing portal-sidebar/portal-topbar/for-you failed)

## Decisions made
- `buildPortalNavItems(basePath, forYouBadge)` drops the old `badges: PortalBadgeCounts, billingModel` signature entirely — badges are no longer a two-field split (`approvalsAwaiting`/`deliverablesPastDue`); the single "For you" badge now sources from F005's `getWaitingOnYouCount` via a new small discriminated type `PortalForYouBadge = { ok: true; total; overdue } | { ok: false }`, matching AS-007's "no number shown on a failed read" rule and giving the badge a danger tone when `overdue > 0` (this feature's own spec: "overdue → danger tone").
- `buildPortalSecondaryNavItems` (Requests/Conversation/How we work) is deleted outright and replaced by `buildPortalProjectNavItems(basePath, billingModel)` — the Project group's children. `billingModel` moved here since Hours is the one item still gated on it.
- Project group expansion state: `expanded = isOnProjectRoute || manuallyExpanded`, where `isOnProjectRoute` is computed by re-running `isItemActive` (prefix match, so nested routes like `/pages/<id>` still match) over `projectItems`. This satisfies "auto-expands on any child route" without a second, parallel active-route check, and matches the spec's "otherwise toggled by the user" — while ON a child route the group can't be manually collapsed (there's no `expanded=false` state reachable that isn't overridden by `isOnProjectRoute`), which is the correct reading of "auto-expands... and marks the child current on any child route" (a user browsing a child page should not be able to hide which section they're in).
- The toggle button carries `aria-expanded={expanded}` per the spec's explicit requirement ("button with aria-expanded").
- Mobile nav renders the identical 4-row structure (Home, For you, Messages, Project [+children when expanded]) inside the existing horizontal `overflow-x-auto` strip — no separate topbar component exists in this codebase (the mobile nav lives inside `portal-sidebar.tsx` itself, see that file's own header comment); there is no `portal-topbar.tsx` mobile variant to update separately.
- `portal-topbar.tsx`'s `STATIC_ROUTE_TITLES` renamed per the clarified spec: `""` (Overview) -> "Home", added `conversation` -> "Messages", `architecture` -> "Site map", `brief` -> "Questionnaire", `for-you` -> "For you". Old route segments (`approvals`, `your-list`, `requests`) keep their old titles in the map in case a stale link resolves before F009's redirect fires.
- `p/[projectId]/layout.tsx` now calls `getWaitingOnYouCount(projectId, todayIso)` (F005) instead of the old `getPortalBadgeCounts`, converting its result into `PortalForYouBadge` before handing it to `PortalSidebar`. `getPortalBadgeCounts` itself is left in `lib/queries/portal.ts` unused by this layout (not deleted — still exported/tested elsewhere by pre-existing tests unrelated to this feature; deleting it is out of this feature's scope).
- `tests/unit/f039-portal-guards.test.ts` needed a new `vi.mock("@/lib/portal/waiting-on-you-count", ...)` alongside its existing `getPortalBadgeCounts` mock, since that test's narrow Supabase client mock (`select().eq().maybeSingle()` only) doesn't support the two-`eq()` chain `getOpenApprovalsForClient`/`getClientDeliverablesForPortal` need — without this the layout's new real call to `getWaitingOnYouCount` would throw inside those pre-existing guard tests. This is the one place outside my declared "Touches" (portal-sidebar/portal-topbar) I edited a test file, and it's a direct consequence of swapping the layout's badge source, not scope creep.

## Out-of-scope work needed
- F009 (old routes redirect): `p/approvals`, `p/your-list`, `p/requests` still exist as real pages, not redirects — not this feature's job.
- F010 (Home callout + wording): not touched here; Home's own page content is unchanged, only its nav label and route title.
- The "Project" group's icon/visual treatment is a simple `FolderKanban` + `ChevronDown` disclosure; no separate stylesheet/animation work was done beyond a `rotate-180` transition class, since nothing in the spec asked for more.
- `getPortalBadgeCounts` (lib/queries/portal.ts) is now unused in production code (only its own tests and the F039 guard test's mock reference it) — a future cleanup pass could remove it, but that's outside this feature's declared touches.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to make the Project group's expanded state non-collapsible while genuinely on one of its child routes (see Decisions made) rather than giving the user a way to hide the active section — the spec's wording ("auto-expands... on any child route") reads as a floor, not a togglable default, and hiding your own current location would be a confusing default.
AUTONOMOUS_DECISION: Kept `getPortalBadgeCounts` in place rather than deleting it, since removing it would touch call sites/tests outside this feature's stated scope (portal-sidebar.tsx, portal-topbar.tsx) for no behavioural gain.

## Notes for the next worker
- No MCP tools were used — this is UI/nav composition over an already-existing helper (`getWaitingOnYouCount`, F005); no schema or policy change.
- `PortalForYouBadge` is exported from `components/portal/portal-sidebar.tsx` — F009/F010 workers needing the same shape should import it from there rather than redefining it.
- The Project group's `key`s for its children are unchanged from the old flat nav's keys (`pages`, `architecture`, `site`, `scope`, `results`, `hours`, `how-we-work`) plus one new one, `brief` — a future worker adding analytics/telemetry keyed on nav item `key` should be aware `architecture`'s `label` changed to "Site map" but its `key`/`href` did not.
