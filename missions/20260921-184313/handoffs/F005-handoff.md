# Handoff: F005 — home-greeting.tsx

## Status
COMPLETE

## Assertions covered
AS-010: PASS — date is formatted via Intl.DateTimeFormat with timeZone set from the `timezone` prop; test asserts a year-shaped date string renders.
AS-011: PASS — heading text matches "Good morning|afternoon|evening, {userName}" based on the hour computed in the given timezone.
AS-012: PASS — subtitle renders the zero-state sentence when all counts are 0, and the "N things need you · N tasks due today · N overdue" combined sentence otherwise (singular/plural handled for count 1).

## Files changed
components/dashboard/home-greeting.tsx
components/dashboard/home-greeting.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run components/dashboard/home-greeting.test.tsx` (0) — 5 passed

## Decisions made
- Used `Intl.DateTimeFormat` with `hourCycle: "h23"` (not `hour12: false`) to compute the current hour in the target timezone, since `hour12: false` can yield "24" for midnight in some ICU implementations; normalized any stray 24 to 0 defensively.
- Date format uses `{ weekday: "short", day: "numeric", month: "short", year: "numeric" }` to match the spec's example "Mon 21 Sep 2026".
- Subtitle builder omits zero-valued segments individually (e.g. if only overdueCount > 0, subtitle is just "1 overdue"), joining with " · ", falling back to the exact all-zero sentence from the spec only when every count is 0. This wasn't explicitly specified for partial-zero cases but follows naturally from the spec's own example and the "if all zero" rule.
- No data-fetching in this component — it's a pure, prop-driven Server Component per the clarified spec ("No interactivity — pure server component"); it does not itself call getCurrentUserTimezone or any query. Wiring it into the workspace home page (app/(workspace)/w/[workspaceSlug]/page.tsx) with real props is out of scope per the "Touches" list (component file only) and not requested by this spec.

## Out-of-scope work needed
- Actually mounting `<HomeGreeting />` on the workspace home page with real `userName`/`timezone`/`attentionCount`/`todayTaskCount`/`overdueCount` values (wiring into app/(workspace)/w/[workspaceSlug]/page.tsx) was not part of this feature's scope (spec only asks to create the component file) — a follow-up feature should wire it in using the existing getCurrentUserTimezone call and F003's needs-you/my-tasks queries already used elsewhere on that page.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `hourCycle: "h23"` over `hour12: false` for hour extraction to avoid the ICU "24 at midnight" edge case — safer default that still satisfies the assertion text (hour-based greeting) without changing observable behavior in normal hours.
AUTONOMOUS_DECISION: For partial-zero counts (e.g. only overdueCount nonzero), subtitle drops the zero segments rather than showing "0 things need you" — inferred from the spec's own example sentence only listing nonzero parts, and the "if all zero" rule implying the alternative branch is for the fully-populated/partial case.

## Notes for the next worker
- Existing pattern reference: components/dashboard/kpi-tile.tsx for Supabase DS card styling; this component doesn't use Card since it's a plain text greeting block, not a tile.
- getCurrentUserTimezone is defined in lib/queries/profile.ts and already called in app/(workspace)/w/[workspaceSlug]/page.tsx — reuse that when wiring HomeGreeting in.
- No MCP usage was needed for this feature (pure UI component, no external service state touched).
