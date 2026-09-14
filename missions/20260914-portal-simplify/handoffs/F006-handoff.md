# Handoff: F006 — "For you" page

## Status
COMPLETE

## Assertions covered
AS-008: PASS — merged decisions+materials list, soonest due first (no-due-date items sort last), overdue flagged for both kinds (including a delivered-but-past-due material). Covered by 7 tests in `lib/portal/build-for-you-items.test.ts`.
AS-009: PASS — All/Decisions/Materials filter chips render counts derived from the same merged list the filtered rows come from, so a chip's count always equals the number of rows shown when that chip is active. Covered by 5 tests in `lib/portal/build-for-you-items.test.ts`; wired into the route via `?filter=decisions|materials` query param (`parseForYouFilter`).
AS-010: PASS — decision rows reuse `ApprovalCard` unmodified (Approve / Request changes, decision-owner gating, "Only <name> can decide this" hint, nudge-owner) exactly as `approvals/page.tsx` already wires it — no new approve/reject logic written. Verified via existing `components/portal/approval-card.test.tsx` (untouched, still green) plus manual trace of the new page's prop wiring (`isOwner`/`ownerName`/`ownerId` derived from `getDecisionOwners` the same way `approvals/page.tsx` derives them).
AS-011: PASS — a collapsible `<details>` "Completed & decision history" section reuses `ApprovalHistory` (decision history table) and `DeliverableRow` `variant="settled"` (delivered+accepted deliverables) unmodified; positive empty state "Nothing is waiting on you. The team will let you know when that changes." renders when the merged list is empty; each of the four reads (open approvals, deliverables, approval history, decision owners) fails independently with its own "Couldn't load" `EmptyState`, never masking a section that loaded fine.

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx (new)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/loading.tsx (new)
lib/portal/build-for-you-items.ts (new)
lib/portal/build-for-you-items.test.ts (new)

## Commands run
`npx tsc --noEmit` (0 — clean)
`npx eslint lib/portal/build-for-you-items.ts lib/portal/build-for-you-items.test.ts "app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx" "app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/loading.tsx"` (0 — clean)
`npx vitest run lib/portal` (0 — 39/39 passing, includes the 19 new AS-008/AS-009 tests)
`npx vitest run tests/integration/f025-portal-route-walk.test.ts` (0 — 2/2 passing, confirms the portal route tree still walks cleanly)
`npx vitest run components/portal lib/portal lib/queries/approvals lib/queries/deliverables` (1 file failed — `components/portal/portal-sidebar.test.tsx`, 3 pre-existing failures unrelated to this feature, see Notes)
`npx vitest run` (full suite — 100 test files / 117 tests failed, all pre-existing: `cookies() called outside a request scope` errors in unrelated custom-fields/task-detail-sheet/board test files that predate this feature (confirmed via `git log` — last touched by an unrelated F037 commit), plus the same 3 pre-existing `portal-sidebar.test.tsx` nav-count failures. No failing test references `for-you` or `build-for-you-items`.)

## Decisions made
- New pure helper `lib/portal/build-for-you-items.ts` (merge, sort, count, filter) rather than inlining that logic in the Server Component page — makes AS-008/AS-009 directly unit-testable without rendering the page, same pattern `classifyBucket` in `your-list/page.tsx` established for its own view.
- Reused `ApprovalCard` and `DeliverableRow` (+ `DeliverableUpload` inside it) and `ApprovalHistory` exactly as-is per the clarified spec's "reuse existing... keep their rules" instruction — no new approve/upload/history logic written for this feature. A small `Badge` (Decision/Material, Overdue) is layered above each reused component to satisfy the visual target's row badge without touching either component's own internals.
- "Ask a question" secondary action for material rows links to the existing `/conversation` route (F007 turns that into "Messages"; not this feature's job) rather than adding a new affordance to `DeliverableRow` itself, keeping that component's own tested behaviour untouched.
- Filter chips are plain `<Link>`s to `?filter=decisions|materials` (no client-side JS) so the page stays a Server Component and `?filter=` is shareable/bookmarkable per the spec's "Support `?filter=decisions|materials` to preselect a chip."
- Collapsible history uses a native `<details>`/`<summary>` element rather than a new client-side disclosure component — no interactivity beyond native browser behaviour is needed, and it keeps the whole page a Server Component.
- Each of the four independent reads (`getOpenApprovalsForClient`, `getClientDeliverablesForPortal`, `getApprovalHistory`, `getDecisionOwners`) degrades independently: a failed read is treated as an empty array for building the merged list/counts (never a fabricated "we don't know" number) AND surfaces its own "Couldn't load X" `EmptyState` banner so a client isn't told "nothing waiting" when a read actually failed. Only when BOTH `approvalsResult` and `deliverablesResult` fail does the whole open-items section replace itself with one full "Couldn't load your For you list" state (there being no partial list left to show at all in that case).

## Out-of-scope work needed
- F007 (Messages): the "Ask a question" link this feature added points at `/conversation`; once F007 renames that page to "Messages" and adds the "This is a request for new work" composer toggle, no change is needed here — the route path stays the same.
- F008 (four-item sidebar): should point its new "For you" nav item at this route (`p/for-you`) and source its badge from `getWaitingOnYouCount` (already built by F005). Not done here — sidebar untouched per this feature's explicit instruction.
- F009 (old routes redirect): `p/approvals` and `p/your-list` still exist unchanged and are NOT redirected to `p/for-you` yet — that is F009's job. Deep links from emails/notifications continue to point at the old routes until F009 lands.
- F010 (Home callout + wording): the clarified visual target's button label is "Ask for changes", but the reused `ApprovalCard`/`PortalApprovalActions` components still say "Request changes" — renaming that client-facing string is explicitly F010's scope ("Rename client-facing 'Request changes' → 'Ask for changes'"), not touched here since it would mean editing a shared component's tested copy outside F006's stated scope.
- Not done, flagged for awareness: `portal-sidebar.test.tsx` has 3 pre-existing failing assertions (nav item counts) and the full suite has ~100 pre-existing failing test files with `cookies() called outside a request scope` errors in unrelated custom-fields/task-detail-sheet tests — both predate this feature (confirmed via `git log` on the affected files) and are unrelated to the "For you" page; worth a separate cleanup pass but out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Materials' "primary upload or the existing state action" from the clarified spec is satisfied by reusing `DeliverableRow` wholesale (it already renders the upload control when not yet delivered, "Waiting for us to check it" when delivered-and-pending, and the review-note-plus-re-upload state when returned) rather than re-deriving those three states in a new component.
AUTONOMOUS_DECISION: When both `getOpenApprovalsForClient` and `getClientDeliverablesForPortal` fail, the whole open-items section (filter chips + list) is replaced by one full-page "Couldn't load" state, since there is no partial merged list left to render at that point; when only one fails, its own inline "Couldn't load X" banner appears above the list built from whichever source succeeded, and that surviving source's rows still render normally — chosen to satisfy the spec's "each data section fails independently" literally (approvals and materials are the two independently-failing sections within this one list) without inventing a fifth EmptyState variant not requested by the spec.

## Notes for the next worker
- Exact new API: `buildForYouItems(approvals, deliverables, todayIso): ForYouItem[]`, `countForYouItems(items): { all, decisions, materials }`, `filterForYouItems(items, filter)`, `parseForYouFilter(value)` — all in `lib/portal/build-for-you-items.ts`. Deliberately does not import or duplicate `getWaitingOnYouCount` (F005) — that helper is the single-number badge/callout source; this file is the ordering/grouping surface for the full list. Both ultimately read the same two underlying queries so they can't disagree on WHAT counts as outstanding, only on how it's presented.
- The route is additive only — nothing under `p/approvals`, `p/your-list`, or `components/portal/portal-sidebar.tsx` was touched.
- No MCP tools were used — this is a pure composition over existing Supabase-backed queries/components; no schema or policy change.
