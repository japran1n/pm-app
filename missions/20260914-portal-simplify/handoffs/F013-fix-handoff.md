# Handoff: F013 — M2 scrutiny fix: for-you links, revalidation, stale-route sweeps

## Status
COMPLETE

## Assertions covered
AS-017: PASS — copy-link now targets /for-you (+approvalId), legacy redirect preserves approvalId, revalidate targets /for-you, old-route sweep widened to app/components/lib.
AS-019: PASS — "Request changes" string sweep widened to app/components/lib excluding app/(workspace).

## Files changed
components/approvals/approvals-queue.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx
components/portal/for-you-scroll-to-item.tsx
lib/actions/portal-deliverables.ts
components/portal/portal-topbar.tsx
components/portal/portal-topbar.test.tsx
tests/unit/f009-legacy-portal-route-redirects.test.ts
tests/unit/f010-as019-no-request-changes-string.test.ts

## Commands run
`npx vitest run tests/unit/f009-legacy-portal-route-redirects.test.ts tests/unit/f010-as019-no-request-changes-string.test.ts components/portal/portal-topbar.test.tsx` (0)
`npx vitest run tests/unit/f083-approvals-queue-row-links.test.tsx tests/unit/f083-approvals-queue-withdraw-confirm.test.tsx tests/integration/f010-approvals-queue.test.ts` (0)
`npx tsc --noEmit -p .` (checked for new errors in touched files only; none found)

## Decisions made
- Chose "blocking" wasn't relevant here; for the scroll/highlight requirement picked the cheapest option per the task: a tiny client component doing `scrollIntoView` + a temporary ring class, no animation lib.
- Removed the dead `approvals`/`your-list`/`requests` entries from `STATIC_ROUTE_TITLES` rather than leaving them "just in case", since the redirect pages never let this component mount for those routes (confirmed by reading their own header comments).
- Widened both sweeps to exclude `app/(workspace)` by directory name (the whole team-facing app section) rather than trying to allowlist individual team files, since that's the exact boundary the mission's CLAUDE.md/task draws ("workspace-side /w/ routes and team-facing strings by rule").
- `hasLegacyRouteLink` previously had a bare `\}\/${segment}` pattern with no `/portal/` requirement; widening the scan surface turned that into false positives against the team's own `/w/.../approvals` inbox link, so I narrowed the matcher to require a `/portal/` prefix on the same line — this is a correctness fix to the sweep itself, not a scope reduction (the docstring already promised this exemption for the team's approvals inbox, the regex just didn't enforce it).

## Out-of-scope work needed
- `components/portal/waiting-on-you-block.test.tsx` and `components/portal/risk-banner.test.tsx` still assert hrefs of `/portal/.../your-list` for a *different* component's test fixtures (not the copy-link/revalidate paths this feature covers). Not touched — outside this feature's file list.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the now-obsolete `EXTRA_FILES`-based test in f009-legacy-portal-route-redirects.test.ts and replaced it with an equivalent named-file regression check (`test_AS_017_the_known_non_portal_directory_call_sites_do_not_link_to_the_old_routes`) since the full-tree sweep already covers those files generically; kept a targeted test so a future refactor moving those files out of `SOURCE_ROOTS` still catches a regression.

## Notes for the next worker
No MCP usage — this feature touches only application code and tests, no live external service state.
