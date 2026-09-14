# Handoff: F009 — Old routes redirect

## Status
COMPLETE

## Assertions covered
AS-017: PASS — `p/[projectId]/approvals` → `p/[projectId]/for-you?filter=decisions`, `p/[projectId]/your-list` → `p/[projectId]/for-you?filter=materials`, `p/[projectId]/requests` → `p/[projectId]/conversation`, and the legacy workspace-level `/portal/<slug>/requests` now lands on `p/<id>/conversation` (not the old project-scoped `requests` route). Every in-app portal-context link to the three old routes was found and repointed (see Files changed). Covered by `tests/unit/f009-legacy-portal-route-redirects.test.ts` (7 tests: 4 direct redirect-target tests, 3 grep-style sweeps over `app/(portal)`, `components/portal`, `lib/portal` plus the two non-portal-directory call sites this feature touched) and the two updated tests in `tests/integration/f003b-relocate-portal-routes.test.ts` that used to assert the old project-scoped `requests` route rendered a page.

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx (now a redirect)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx (now a redirect)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/requests/page.tsx (now a redirect)
app/(portal)/portal/[workspaceSlug]/requests/page.tsx (legacy workspace-level redirect target updated)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx (RiskBanner's yourListHref)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx ("More" section's Requests link → Messages)
components/portal/approval-card.tsx ("See who to raise it with" link)
components/portal/change-requests-table.tsx ("Review this quote" link)
lib/portal/build-waiting-on-you-items.ts (Overview's "What we need from you" block links)
lib/portal/classify-deliverable-bucket.ts (new — `classifyBucket` moved out of the now-redirect-only `your-list/page.tsx`)
components/portal/approval-card.test.tsx (updated href assertion)
lib/portal/build-waiting-on-you-items.test.ts (updated href assertions)
tests/integration/f003b-relocate-portal-routes.test.ts (two tests updated to assert the new redirect behaviour instead of old rendered markup)
tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts (import path updated to the moved `classifyBucket`)
tests/unit/portal-title-context.test.tsx (Overview → Home, a direct fallout of F008's route-title rename not caught until this feature's full-suite run)
tests/unit/f009-legacy-portal-route-redirects.test.ts (new — AS-017's own test file)

## Commands run
`npx vitest run tests/unit/f009-legacy-portal-route-redirects.test.ts` (0 — 7/7 passing)
`npx vitest run lib/portal/build-waiting-on-you-items.test.ts tests/integration/f003b-relocate-portal-routes.test.ts tests/unit/f039-portal-guards.test.ts` (0 — 22/22 passing)
`npx vitest run components/portal/approval-card.test.tsx tests/unit/portal-title-context.test.tsx` (0 — 28/28 passing)
`npx tsc --noEmit` (0 — clean)
`npx eslint <all files changed above>` (0 — clean, run in two batches)
`npx vitest run tests/unit components/portal lib/portal` (4 files / 5 tests failed — the exact same pre-existing failures F006/F007/F008's own handoffs already documented: `app-sidebar-project-nav-list` (AS-509, AS-513), `f017-suspense-fallback-footprint`, `f038-as024-coverage`, `xss-sanitization-audit`. Nothing this feature touched failed. 2988/2993 tests passed.)

## Decisions made
- All three project-scoped legacy pages became pure `redirect()` server components with no lookup of their own (no `getPortalProjects`/`notFound` check inside them), matching the exact pattern the mission spec named: "Keep the route files as server `redirect()` only (pattern: `requests/page.tsx`)." — except this pattern reference is actually simpler than that file (which needs a workspace/project LOOKUP because it lives one level up, outside the project-scoped shell). These three routes already have `projectId` in their own URL and already render as children of `p/[projectId]/layout.tsx`, which has ALREADY validated the project (404s otherwise) by the time any of these three components mount — so re-deriving/re-checking the project here would be redundant work the layout already did. Each is a two-line body: destructure params, `redirect()`.
- No deep-link anchors to preserve: none of the three old pages ever accepted a `searchParams`/query param carrying an item id (checked directly — grepped all three for `searchParams`, found none), so "preserve deep-link anchors where an item id is passed" from the spec doesn't apply here; the only "anchor" this feature does carry forward is the filter chip (`?filter=decisions|materials`), which F006's "For you" page already supports natively via `parseForYouFilter`.
- The legacy workspace-level `/portal/<slug>/requests/page.tsx` redirect target changed from `.../requests` to `.../conversation` — per the mission's own instruction ("Legacy workspace-level `/portal/<slug>/requests` should land on the new Messages route").
- `classifyBucket` (a real, independently-tested piece of logic living inside `your-list/page.tsx`, not a page component itself) was extracted to `lib/portal/classify-deliverable-bucket.ts` rather than deleted, per the spec's "keep reusable components" instruction — deleting it would have silently dropped `tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts`'s entire coverage of an earlier mission's AS-003 (M3 remediation: "changing `your-list/page.tsx:40` to `return 'waiting'` kept the whole suite green" was exactly the regression that test suite exists to catch).
- `NewRequestForm` (components/portal/new-request-form.tsx) is now unreferenced by any page (the old `p/[projectId]/requests/page.tsx` was its only call site) but was left in place — it's a component, not a page, its own test file still exercises it directly, and the spec's instruction is "keep reusable components" / only delete page components with zero importers. Flagged below for a future cleanup pass.
- The grep-style sweep test (`f009-legacy-portal-route-redirects.test.ts`) deliberately scopes its walk to `app/(portal)`, `components/portal`, `lib/portal` (not the whole repo) plus two named extra files, so a team-side `/w/<slug>/requests` or `/w/<slug>/approvals` link (an unrelated, real, still-live route for the team's own inbox) can never false-positive it. Its regex requires a URL-shaped occurrence (`${...}/segment` or `/portal/.../segment`) rather than a bare substring match, so import specifiers like `@/lib/queries/approvals` and identifiers like `ApprovalCard` don't false-positive it either — an earlier, looser regex draft did trip on exactly those and was tightened.

## Out-of-scope work needed
- F010 (Home callout + wording): not touched here.
- A full repo-wide sweep of `lib/actions` (e.g. notification/email link builders outside `lib/portal`) turned up no additional hardcoded links to the three old routes — checked via a broader grep before narrowing the test's own walk to the three portal-specific directories; if a future feature adds an email template linking into the portal, it should link at `for-you`/`conversation` directly, not `approvals`/`your-list`/`requests`.
- `NewRequestForm` (components/portal/new-request-form.tsx) has no remaining call site in `app/` — not deleted (still a tested, reusable component per this feature's own scope rule), but a future cleanup feature could either delete it or find it a new use.
- `lib/queries/portal.ts`'s `getPortalBadgeCounts` remains unused in production code since F008 (this feature didn't touch it further) — same out-of-scope note F008's handoff already raised.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Fixed `tests/unit/portal-title-context.test.tsx`'s stale `"Overview"` assertion (should have been caught by F008's own commit, since F008 renamed the Overview route's title to "Home") while running this feature's own full-suite verification pass — treated as "keep the suite green," not scope creep, since it's a one-line assertion update with no behavioural change of its own.
AUTONOMOUS_DECISION: Extracted `classifyBucket` into a new shared file rather than either deleting its test coverage or leaving a redirect-only page exporting unrelated business logic — narrowest change that keeps both the redirect (spec's explicit ask) and the pre-existing test suite (this mission's "don't delete coverage" rule) intact.

## Notes for the next worker
- No MCP tools were used — this feature only touches Next.js routing (`redirect()`) and static link targets; no schema, policy, or live-data change.
- The three legacy project-scoped pages (`approvals`, `your-list`, `requests`) are now three-line files: destructure `{ workspaceSlug, projectId }` from `params`, call `redirect()`. If a future feature needs to add analytics/telemetry on "someone hit an old bookmark," these three files are the one place to add it.
- `for-you`'s own `parseForYouFilter` (lib/portal/build-for-you-items.ts) already treats any unrecognized `?filter=` value as `"all"` — the two new redirect targets (`?filter=decisions`, `?filter=materials`) were verified against that existing parser, not a new one.
