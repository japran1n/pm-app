# Handoff: F079 — Client portal audit: three correctness defects

## Status
COMPLETE

## Assertions covered
This is a hardening/audit task with no pre-assigned assertion IDs (no
`missions/20260903-portal/features/F079-*.md` exists — this was dispatched
directly). No AS-NNN IDs to report against; coverage is documented per-defect
below instead.

## Files changed
lib/queries/approvals.ts
lib/actions/approvals.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/requests/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/page.tsx
components/portal/new-request-form.tsx
components/portal/request-list.tsx
components/portal/approval-card.tsx
components/portal/change-requests-table.tsx
components/portal/metric-comparison-card.tsx
tests/integration/f009-decide-approval-action.test.ts
tests/unit/portal-approvals-query.test.ts (new)
components/portal/new-request-form.test.tsx (new)
components/portal/change-requests-table.test.tsx (new)
components/portal/approval-card.test.tsx (added a case)
components/portal/metric-comparison-card.test.tsx (added a case)
components/portal/request-list.test.tsx (added two cases)

## Commands run
`npx vitest run tests/unit/portal-approvals-query.test.ts tests/integration/f009-decide-approval-action.test.ts tests/integration/f003b-relocate-portal-routes.test.ts components/portal/request-list.test.tsx components/portal/new-request-form.test.tsx components/portal/approval-card.test.tsx components/portal/change-requests-table.test.tsx components/portal/metric-comparison-card.test.tsx` (0, 60 tests passed)
`npx vitest run tests/integration/f008-request-approval-action.test.ts` (0, 10 tests passed — real Supabase, exercises `getDecisionOwnersForDialog`, which wraps the changed `getDecisionOwners`)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx eslint <every touched file>` (0)

## Decisions made

**Defect 1 (failed read renders as empty).** Grepped and confirmed the
cited precedent before adopting it: `PortalQueryResult<T>` is defined at
`lib/queries/portal.ts:270-272` (`{ ok: true; data: T } | { ok: false; error:
string }`), and the "Couldn't load" `EmptyState` convention is at
`app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx:82-93`
(`getProjectMetricsWithLatestSnapshot`'s failure branch). Both claims in the
audit were accurate. Gave `getOpenApprovalsForClient`, `getApprovalHistory`,
and `getDecisionOwners` (all in `lib/queries/approvals.ts`) the same
`PortalQueryResult<T>` return shape (imported the type from
`lib/queries/portal.ts`, did not edit that file — it's on the concurrent-edit
exclusion list). Updated every caller: the approvals portal page (three
independent "Couldn't load X" sections — a broken owners read never hides
open approvals that DID load, matching this mission's own "independently
failable" assertion-quality rule), the project settings page's "Who approves
what" grid (folded into its existing page-level `loadError` state, since that
page already has one shared failure UI for every read on it), and
`getDecisionOwnersForDialog` (`lib/actions/approvals.ts`, unwraps into its
own pre-existing `GetDecisionOwnersResult` shape).

**Test-fails-first proof (defect 1).** Per instructions: mutated
`getOpenApprovalsForClient`'s error branch back to `return { ok: true, data:
[] }`, ran `tests/unit/portal-approvals-query.test.ts`, confirmed
`test_open_approvals_failed_read_returns_ok_false_not_an_empty_array` failed
with the exact wrong-value diff (`{ok:true,data:[]}` vs expected
`{ok:false,...}`), then reverted the mutation and confirmed all 7 tests pass.

**Defect 2 (Requests shows every project).** Grepped: `p/[projectId]/page.tsx:135-139`
does filter `overview.deliveredThisWeek` down to `project.id` — confirmed real
precedent. `lib/queries/portal.ts` (home of `getPortalRequests`/
`getPortalProjectOptions`) is on the concurrent-edit exclusion list, so
`getPortalRequests` itself stays workspace-wide; the requests page now
filters its result to `projectId` the same way the overview page filters
`deliveredThisWeek` — read stays wide, the one caller that needs it narrow
narrows it. Decided to DROP the project picker entirely (not just default it)
once the page is project-scoped: the URL, shell nav, and every sibling tab
already say "you are inside one project," and `getPortalProjects` (called
earlier in the same page to resolve `project`) already proves this project is
portal-enabled, so a picker offering other projects has no honest use left —
it would just let a client file a request against a project the page they
are looking at has nothing to do with. Replaced the `<select>` with a fixed
hidden `projectId` field via a new `fixedProjectId` prop on `NewRequestForm`
(kept the old `projects`-driven `<select>` path alive, unused today, in case
a workspace-wide caller returns).

Also found and fixed a second half of the same leak while implementing this:
`RequestList`'s Realtime channel (`subscribeToPortalRequestListRealtime`) has
no server-side row filter at all (by design — RLS already gates what the
session's channel can receive), so even with the initial list scoped, a live
INSERT/UPDATE for a different project of the same workspace could still land
in the rendered list post-mount. Added an optional `projectId` prop to
`RequestList` that filters every live update the same way the initial list is
filtered. Covered by two new tests
(`test_projectId_scoping_a_live_insert_for_a_different_project_is_dropped` /
`..._for_the_current_project_still_lands`).

**Defect 3 (date-only columns render a day early).** Verified column types
directly against migration SQL rather than trusting the audit's wording:
- `approval_requests.due_at` — `timestamptz`
  (`20260916010000_approval_requests.sql:49`), BUT
  `lib/validation/approvals.ts`'s `dueAtSchema` only ever accepts a plain
  `YYYY-MM-DD` string, written straight to the column with no time component
  (`lib/actions/approvals.ts:326`) — Postgres stores that as UTC midnight, so
  the app-level convention is genuinely date-only despite the column type.
  Fixed `approval-card.tsx`'s `formatDate` to match `deliverable-row.tsx`'s
  pattern (append `T00:00:00Z` if no `T` present, pin `timeZone: "UTC"`).
- `change_requests.quote_valid_until` — genuine `date` column
  (`20260930010000_f016_change_requests_quote_gate.sql:39`). Added a second,
  separate `formatDateOnly` in `change-requests-table.tsx` for this ONE
  field — `createdAt`/`decidedAt` in the same component are real
  `timestamptz` moments (`decided_at timestamptz`, same migration line 43)
  and were deliberately left on the existing unpinned `formatDate`, per the
  spec's own "don't mix up date vs. timestamptz" warning.
- `project_metrics.baseline_at` / `metric_snapshots.measured_at` — genuine
  `date` columns (`20261013010000_f020_..._baseline_freeze.sql:76,110`).
  `metric-comparison-card.tsx`'s `formatDate` already appended the synthetic
  `T00:00:00Z` but never passed `timeZone: "UTC"` to `toLocaleDateString` —
  fixed by adding the option, same as every other correct instance in this
  codebase.

**Sweep results (every `toLocaleDateString`/`toLocaleString` call under
`components/portal/**` and `app/(portal)/**`)** — reported all, fixed the
three that were genuinely date-only and unpinned:
- `approval-card.tsx` `dueAt` — FIXED (date-only convention, was unpinned).
- `change-requests-table.tsx` `quoteValidUntil` — FIXED (new `formatDateOnly`,
  `formatDate` unchanged for `createdAt`/`decidedAt`, both `timestamptz`).
- `metric-comparison-card.tsx` `baselineAt`/`measuredAt` — FIXED (added
  missing `timeZone: "UTC"`; the `T00:00:00Z` append was already present).
- `deliverable-row.tsx` `dueAt`, `decision-log.tsx` `decidedOn`,
  `project-progress.tsx` `nextDue.dueDate`, `task-list.tsx` `task.dueDate`,
  `portal-topbar.tsx` `launchDate`, `project-accounts-table.tsx` a
  `renewal`/similar date field, `launch-day-card.tsx` — already correctly
  pinned (verified each appends `T00:00:00Z` AND passes `timeZone: "UTC"`);
  no change needed.
- `approval-history.tsx` `decidedAt`, `file-list.tsx` `createdAt`,
  `pages-table.tsx` `updatedAt` (called `formatUpdatedAt`), `request-list.tsx`
  `createdAt`, `portal-overview-live.tsx` `task.updatedAt`, `conversation.tsx`
  message timestamps, `hours-burndown-chart.tsx` a locally-computed Monday
  (not a stored column at all), `app/(portal)/.../[workspaceSlug]/page.tsx`
  and `p/[projectId]/page.tsx`'s `activity.since`, `results/page.tsx`'s
  `baselineFrozenAt` — verified each backing column is `timestamptz` (a real
  moment: `decided_at`, `created_at`, `updated_at`, `portal_last_seen_at`
  (via `since`), `baseline_frozen_at`) — correctly left unpinned. Pinning a
  genuine `timestamptz` to UTC would be the OPPOSITE bug the task warned
  against.

## Out-of-scope work needed
None identified beyond this feature's own scope. `getDecisionOwnerNames`
(F010's batched cross-project lookup, also in `lib/queries/approvals.ts`)
has the same `[]`-on-error shape as the three functions fixed here, but it
returns a `Map`, is consumed by a different page (the team queue, not the
client portal), and was not named in the audit — left untouched; flagging
here in case a follow-up wants the same treatment.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the project `<select>` from the portal's
Requests page entirely rather than merely defaulting it to the current
project, because the page is now single-project-scoped end to end (URL,
shell, and the underlying data) and a picker offering other projects had no
honest purpose left — see "Decisions made" above for the full reasoning.

AUTONOMOUS_DECISION: Split the three approvals-page sections (open
approvals, decision history, decision owners) into independently-failing
"Couldn't load" states rather than one page-wide failure, since the three
reads are logically independent and a broken owners grid should not hide a
successfully-loaded open-approvals list.

AUTONOMOUS_DECISION: Also fixed `RequestList`'s Realtime channel to respect
the new `projectId` scope (not explicitly named in the audit's defect 2 text,
but required to actually close the leak once the page itself is
project-scoped — the channel has no server-side row filter, so a live insert
for another project could otherwise still reach the rendered list post-mount).

## Notes for the next worker
- `lib/queries/portal.ts`, `components/portal/phase-timeline.tsx`,
  `components/portal/overview-tiles.tsx`, `components/portal/hours-tiles.tsx`,
  `scripts/seed-demo.mjs`, `tests/integration/f020b-projects-allowlist-guard.test.ts`,
  and `app/(portal)/**/hours/page.tsx` were NOT touched (concurrent-edit
  exclusion list) — `getPortalRequests`/`getPortalProjectOptions` themselves
  stay workspace-wide by necessity; the requests page filters their result.
- The full suite was intentionally not run (per instructions — local
  Supabase auth rate-limiting). Targeted vitest runs above cover every file
  changed, including two real-database integration tests
  (`f009-decide-approval-action.test.ts`, `f008-request-approval-action.test.ts`)
  that exercise the changed query/action shapes against a live Supabase
  project.
- No MCP tools were used — this task is pure application-code/test work
  (query return shapes, page rendering, date formatting); no live schema or
  policy introspection was needed beyond reading migration SQL already in
  the repo to confirm column types (`due_at`, `quote_valid_until`,
  `baseline_at`, `measured_at`, `decided_at`, `created_at`, `updated_at`,
  `baseline_frozen_at`).
