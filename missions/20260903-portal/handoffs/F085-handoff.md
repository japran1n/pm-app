# Handoff: F085 — Client-portal UX audit fixes (7 defects + 1 layout defect)

## Status
COMPLETE

## Assertions covered
This is an audit-fix feature, not one with its own assigned assertion IDs in
`validation-contract.md`. Existing assertions whose behaviour changed:
AS-002: PASS — Overview "Waiting on you" tile now unions open approvals,
  pending-approval tasks and past-due deliverables, and is a link.
AS-031: PASS — Risk banner names the item, its due date, and links to Your list.
AS-034: PASS — Hours Remaining shows the real overage when over budget; Against
  plan uses the blocked token (not waiting) when over pace.
AS-017: PASS — StatusDistribution's label set is now a caller-supplied prop;
  Pages view is unaffected (still defaults to CLIENT_BUCKET_LABELS).
AS-021/AS-022: PASS — ApprovalCard still gates Approve/Request changes on
  `isOwner`; non-owner and unassigned cases now carry an action.

## Files changed
lib/queries/portal.ts
lib/queries/deliverables.ts
lib/queries/approvals.ts
components/portal/overview-tiles.tsx
components/portal/overview-tiles.test.tsx
components/portal/risk-banner.tsx
components/portal/risk-banner.test.tsx
components/portal/hours-tiles.tsx
components/portal/hours-tiles.test.tsx (new)
components/portal/status-distribution.tsx
components/portal/status-distribution.test.tsx
components/portal/approval-card.tsx
components/portal/approval-card.test.tsx
components/portal/decision-owners-grid.tsx
components/portal/decision-owners-grid.test.tsx (new)
components/portal/portal-sidebar.tsx
components/portal/portal-sidebar.test.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx
tests/unit/portal-waiting-on-you-count.test.ts (new)
tests/unit/portal-overview-queries.test.ts (fixture rows updated for new `title` field)

## Commands run
`npx vitest run components/portal tests/unit/portal-waiting-on-you-count.test.ts tests/unit/portal-overview-queries.test.ts tests/unit/portal-approvals-query.test.ts tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts` (0, 221 tests passed)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx eslint <all changed .ts/.tsx files>` (0)

## Decisions made

Verified each of the 7 claims against the real code before changing anything;
all 7 (plus the layout defect) were real. Findings and fixes:

1. **Hours dead tile (real).** F019 (the Hours view) exists and is fully
   built (`app/(portal).../hours/page.tsx`, `lib/queries/hours.ts`), so F006's
   Overview placeholder ("Available with the next release") was stale, not a
   still-true statement. Wired the Overview tile to the same
   `getProjectHoursClient`/`getProjectCurrentBudgetPeriod` read the Hours view
   itself uses (one source, never a second guess) and made it a link to
   `/hours`. Deleted the duplicate right-rail placeholder entirely rather than
   wiring it too — one honest tile, not two.

2. **Tile/badge disagreement (real).** Added `getPortalWaitingOnYouCount`
   (lib/queries/portal.ts) — the union of owned pending `approval_requests`,
   `pending_client_approval` tasks, and past-due deliverables, deduped by
   `task:<id>` for a task-subject approval and its task row (they're the same
   obligation: `tasks.pending_client_approval` stays true exactly as long as a
   task-subject approval is open). The tile now reads this instead of
   `waitingOnYouResult.data.length`, and is a link to Approvals.

3. **Over-budget "Remaining 0h" (real).** `Math.max(remainingMinutes, 0)`
   confirmed at hours-tiles.tsx:67 (old line number). Remaining now shows the
   real overage ("+2.0h"), the footnote says "Over the budget", a next-step
   line appears, and the tile carries a status icon + `sr-only` text (colour
   is never the only signal, matching this codebase's own convention). Fixed
   "Against plan" to key its own over/under state off itself (pace, not the
   whole-budget overrun) and use the blocked token, not waiting, when over —
   the audit's own finding.

4. **Your list borrows Pages vocabulary (real).** `StatusDistribution` was
   hard-wired to `CLIENT_BUCKET_LABELS`. Made `labels` a prop (defaults to
   `CLIENT_BUCKET_LABELS` so the Pages view, its only other caller, is
   unchanged) and gave Your list its own map: `blocked` → "Overdue" (says
   plainly what "you're late" means, rather than reusing generic team
   jargon), plus its own wording for the other three buckets.

5. **Risk banner names nothing (real).** Extended `DeliverableRisk`
   (lib/queries/deliverables.ts) and `PortalRisk` (lib/queries/portal.ts) with
   `itemName`/`dueAt`, both sourced from the SAME row the message is already
   built from (added `title` to the existing `.select(...)`, no second
   query). `RiskBanner` now takes a `yourListHref` prop (built by the caller,
   which has the workspace slug this query doesn't) and each row is a `Link`
   naming the item and its due date above the sentence.

6. **Approval card hides timing / gives non-owner nothing to do (real).**
   `requestedAt`/`round` render as "Requested 1 Aug · Round 2" (round only
   shown when >1 — round 1 isn't a re-submission). Added `email` to
   `PortalDecisionOwner`/`getDecisionOwners` (sourced via the same
   `resolvePeople` call already resolving name/avatar — no new query). A
   non-owner now sees "Ask Jane to take a look" (`mailto:`) when the owner has
   a resolvable email, or "See who to raise it with" (links to Approvals) when
   there's no owner at all. `DecisionOwnersGrid`'s "No owner assigned" gained
   "Raise it with your project team."
   AUTONOMOUS_DECISION: chose a `mailto:` link over a new in-app
   notification/nudge action. `lib/actions/portal-approval.ts`,
   `lib/actions/client-requests.ts`, `lib/actions/portal-deliverables.ts` and
   `lib/notifications/**` are all off-limits (a concurrent agent is editing
   them) — a real notification-based nudge needs a new `NotificationKind` in
   `lib/notifications/fanout.ts` (off-limits) and a new server action in one
   of the off-limits `lib/actions/*` files. `mailto:` needed no new server
   action and no new notification kind, satisfies "a way to ask the named
   owner to look" honestly, and reuses an email already being resolved
   server-side.

7. **Hours "By month" percentages don't sum (real).** Confirmed
   `${minutes/soldMinutes}% of the current budget` per row at the cited line.
   Took the "drop the note and add a total row" option (simpler and provably
   correct — a client can check the total by adding the rows themselves)
   over cumulative percentages, which would still require explaining what the
   percentage is cumulative OF.

8. **Layout defect (real).** `NavRow` unconditionally applied `w-full` and
   was reused inside the mobile `overflow-x-auto` strip. Added a `layout`
   prop (`"desktop" | "mobile"`, defaults to `"desktop"` so existing call
   sites are unchanged) and only apply `w-full` when `layout === "desktop"`.
   Both mobile call sites (primary + secondary/TEMPORARY rows) now pass
   `layout="mobile"`.

## Out-of-scope work needed
None identified beyond this feature's own scope — all 7 claims plus the
layout defect were real and are now fixed. A genuine in-app "nudge" action
(server-side notification, not `mailto:`) for approval-card's non-owner case
would need a new `PortalNotificationKind` in `lib/notifications/fanout.ts` and
a new server action — both currently off-limits to this worker; a future
feature could pick this up once those files are free.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: used `mailto:` instead of a new notification-based nudge
for approval-card's non-owner "ask the owner" action — see item 6 above for
the full reasoning (the natural implementation touches files a concurrent
agent owns).
AUTONOMOUS_DECISION: for defect 7 (By month percentages), chose "drop the
note, add a total row" over "make it cumulative" — both were offered as
acceptable fixes by the spec; the total row is simpler and self-verifiable.
AUTONOMOUS_DECISION: deleted the Overview page's right-rail "Hours used"
placeholder rather than wiring it to real data too, since the tile above the
fold now carries the real number — one honest tile beats two identical ones.

## Notes for the next worker
- Could NOT visually verify the portal at 375px in a real browser in this
  environment (no interactive browser session available to this worker) —
  the sidebar layout fix (`portal-sidebar.tsx`) is covered instead by
  `test_AS_085_mobile_nav_rows_do_not_carry_w_full_but_desktop_rows_do`
  (components/portal/portal-sidebar.test.tsx), which asserts the mobile
  anchor's class list does not contain `w-full` while the desktop anchor's
  does. Please spot-check visually if you get a browser session on this repo.
- No MCP tools were needed for this feature — every change is application
  code and existing-table reads (no schema change, no new tables).
- `getPortalWaitingOnYouCount`'s dedup logic assumes
  `tasks.pending_client_approval` is kept in sync with a task-subject open
  `approval_requests` row (documented at 20260916010000_approval_requests.sql:14-16,
  and re-verified by reading `decide_approval_atomic`'s own body, lines
  ~428-430 of that migration, which clears the flag on decide). If a future
  migration breaks that invariant, the union count could double-count or
  under-count task-subject approvals — the dedup key comment in
  `lib/queries/portal.ts` explains the assumption inline.
