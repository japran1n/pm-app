# Handoff: F017 — M2 scrutiny fix: design-system minors + waiting-on-you consistency

## Status
COMPLETE

## Assertions covered
AS-016: PASS (design/consistency minors listed under F017 in the task; no new assertion ID was assigned to this feature beyond the existing design-system scope — see Decisions made for how each item maps to the mission's Supabase Design System rules in CLAUDE.md).

## Files changed
components/portal/request-list.tsx
components/portal/portal-sidebar.tsx
components/chat/message-composer.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx
lib/portal/waiting-on-you-count.ts
lib/portal/waiting-on-you-count.test.ts
lib/portal/build-for-you-items.ts
lib/portal/build-for-you-items.test.ts
lib/portal/is-past-due.ts (new)
lib/queries/deliverables.ts

## Commands run
`npx vitest run tests/unit/portal-waiting-on-you-count.test.ts lib/portal/waiting-on-you-count.test.ts lib/portal/build-for-you-items.test.ts` (0)
`npx vitest run tests/unit/f039-portal-guards.test.ts tests/unit/f010-home-callout-wiring.test.ts tests/unit/portal-overview-queries.test.ts tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts` (0)
`npx vitest run tests/unit/f014-for-you-failure-states.test.tsx` (0)
`npx vitest run components/portal/portal-sidebar.test.tsx tests/unit/f007-messages-request-toggle.test.tsx tests/unit/f015-message-composer-request-mode-rich-editor.test.tsx` (0)
`npx tsc --noEmit -p .` (no new errors)
`npx eslint components/portal/request-list.tsx components/portal/portal-sidebar.tsx components/chat/message-composer.tsx "app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx" lib/portal/waiting-on-you-count.ts lib/portal/build-for-you-items.ts lib/portal/is-past-due.ts lib/queries/deliverables.ts "app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx"` (0)

## Decisions made
- request-list status: mapped to Badge variants `secondary` (submitted), `warning` (in_review), `success` (accepted), `destructive` (declined) — these are the badge component's own existing semantic variants (components/ui/badge.tsx), never a hand-written hex or Tailwind colour class.
- Checkbox: base-ui's `Checkbox` primitive uses `checked`/`onCheckedChange` (tri-state `boolean | "indeterminate"`), not native `onChange`/`e.target.checked` — wired as `onCheckedChange={(checked) => setIsRequest(checked === true)}`.
- The biggest behavioural piece of this feature: redefined "waiting on you" materials to exclude `delivered` state (awaiting the TEAM's review, not the client's action) from both `getWaitingOnYouCount` and the "For you" merged list/counts (`outstandingDeliverables` in build-for-you-items.ts). Delivered-but-unreviewed materials are still shown to the client, moved into a new "Awaiting our review" block inside the History disclosure (not counted anywhere), so nothing becomes invisible — the count and the main list now agree by construction (same predicate, same source, per AS-009's own "counts match rows" rule).
- Deduplicated `isApprovalPastDue` into `lib/portal/is-past-due.ts` and made the UTC-date-only truncation explicit (`toUtcDateOnly`) on both sides of every past-due/same-day comparison (approvals' `timestamptz` vs deliverables' `date`) — this was previously correct by accident of string-prefix ordering; now it's a documented, tested rule. Fixed the same-day merge-sort bug in `buildForYouItems` the same way.
- Messages page header spacing changed from the ad hoc `p-4 pb-0` to the design system's own page-header rule (`p-6 pt-4 lg:p-8 lg:pt-8`); the "Your requests" section got `max-h-64 overflow-y-auto` with a sticky heading rather than a `<details>` collapsible, to keep it always partially visible without extra interaction.

## Out-of-scope work needed
- `components/portal/waiting-on-you-block.test.tsx` and `components/portal/risk-banner.test.tsx` still reference `/portal/.../your-list` hrefs in their own fixtures — unrelated to this feature's files, not touched.
- No other raw `<input type="checkbox">` or hard-coded Tailwind colour literals were found elsewhere in the portal client-facing surface during this pass (grepped `text-blue-600`/`text-emerald-600` and `type="checkbox"` across `app/(portal)` and `components/portal`+`components/chat`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to keep `delivered` materials visible (in a new "Awaiting our review" history block) rather than dropping them from the UI entirely, since the task's own wording ("For you labels them as awaiting the team") implies the label should exist, not that the material should vanish.

## Notes for the next worker
No MCP usage — pure application code + tests, no live external service state touched.
