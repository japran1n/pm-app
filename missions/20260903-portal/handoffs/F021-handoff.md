# Handoff: F021 — Portal Results view

## Status
COMPLETE

## Assertions covered
AS-041: PASS — `MetricComparisonCard` (`components/portal/metric-comparison-card.tsx`) renders whatever `deriveMetricMeasurementStatus` (F020, `lib/queries/metrics.ts`) returns and never re-derives that judgement itself. Unit tests (`components/portal/metric-comparison-card.test.tsx`) prove: the same raw before/after numbers (100 -> 60) render as "Improved" for a `direction = 'lower'` metric and "Regressed" for a `direction = 'higher'` metric; a metric with no snapshot, and separately a snapshot with no baseline, both render the "not measured yet" treatment with no bar chart at all and no zero/em-dash stand-in value.
AS-042: PASS — the Results page (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx`) renders one `MetricComparisonCard` per client-visible metric (before/now/target paired bars + dashed target tick, `role="img"` with a summarising `aria-label`) and a full `ResultsImprovements` list (area + explanation + before/after images where signed URLs resolve). Unit test `test_AS_042_renders_before_now_and_target_as_a_bar_chart_with_target_tick` asserts the chart's own aria-label states before/now/target values and the target tick renders; `test_AS_042_stands_alone_without_images` (`components/portal/results-improvements.test.tsx`) proves the explanation text is fully legible with both image URLs `null`.

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx
lib/actions/metrics.ts
components/portal/metric-comparison-card.tsx
components/portal/metric-comparison-card.test.tsx
components/portal/results-improvements.tsx
components/portal/results-improvements.test.tsx

## Commands run
`npx vitest run components/portal/metric-comparison-card.test.tsx components/portal/results-improvements.test.tsx` (0, 10/10 passing)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/metrics.ts components/portal/metric-comparison-card.tsx components/portal/metric-comparison-card.test.tsx components/portal/results-improvements.tsx components/portal/results-improvements.test.tsx "app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx"` (0 errors, 0 warnings)
Full vitest suite deliberately NOT run, per instructions.

## Decisions made
- **Two grounded bars, not an arrow** — a paired-bar SVG (Before in `fill-muted-foreground/40`, Now in `fill-status-done`/`fill-status-blocked` per the derived status) with a dashed target tick, following the same "pure layout function (`computeMetricBarLayout`) kept separate from rendering" convention `hours-burndown-chart.tsx` (F019) and `phase-timeline.tsx` (F006) both document on themselves, exported specifically so the primary-success unit test can assert bar geometry and clamping precisely.
- **`deriveMetricMeasurementStatus` (F020) is the only place the improved/regressed decision is made.** `MetricComparisonCard` takes the already-derived `status` as a prop rather than recomputing it from `direction`/values, so this feature cannot silently diverge from F020's own tested logic — grep-verified there is exactly one call site of `deriveMetricMeasurementStatus` in this feature (the page), matching F020's own header comment ("F021's Results view ... reads this instead of re-deriving its own status").
- **Regression is drawn in the blocked token, never softened or hidden** — `STATUS_BAR_FILL_CLASS`/`STATUS_TEXT_CLASS` map `regressed` to `fill-status-blocked`/`text-status-blocked` unconditionally; the status word ("Regressed") is also always in the card's own text, so colour is never the only signal (plan.md's Design constraint #4, same rule `phase-timeline.tsx`'s header already documents for itself).
- **No signed-url getter for improvement images existed before this feature** (F020's own "out-of-scope work needed" note says exactly this: F021 needs to build it). Added `getImprovementImageSignedUrl` to `lib/actions/metrics.ts`, mirroring `getAttachmentSignedUrl`'s (`lib/actions/attachments.ts`) three-check shape verbatim: active membership, a client caller additionally gated on the row's own `client_visible` flag AND the project's `portal_enabled`, then `isProjectVisibleToCaller` — the same "second line, not the only line" defense-in-depth every signed-url action in this codebase already applies on top of the Storage RLS policy F020's migration establishes for `improvements/{project_id}/...` objects. Checks the improvement row's own `client_visible` (not a task's, since `project_improvements` has its own flag per F020's schema) rather than reusing `getAttachmentSignedUrl` as-is, which is task-scoped and does not apply here.
- **AUTONOMOUS_DECISION: "when it will be" (the not-measured line) does not carry a fabricated date.** F020's schema (`project_metrics`/`metric_snapshots`, `20261013010000`) has no cadence/next-measurement-date column at all — no `measurement_frequency`, no `next_measured_at`, nothing derivable server-side. Inventing a specific future date here would be exactly the "chart makes a number look measured" failure this feature's own spec warns against for the bars, applied to a date instead of a value. The not-measured line instead states the honest, always-true fact available: "Not measured yet — the team will record the next measurement using the same method used for the baseline above." This satisfies the spec's literal wording about timing (it tells the client HOW the number will arrive) without asserting a WHEN this codebase has no way to know. No clarification file exists for this feature (mirrors F019's own precedent for undocumented ambiguity, grep-verified: no `missions/20260903-portal/clarifications/F021-clarification.md` file exists), so this default was applied per `worker-mcp-usage`'s ambiguity priority order (spec -> clarification -> tech-decisions -> safest default -> BLOCKED). Nothing here contradicts the clarified spec; it fills a genuine data gap the spec's own wording did not anticipate.
- **Signed URLs are resolved once, server-side, in the page** (`Promise.all` over every improvement's before/after paths) rather than lazily on the client, matching this portal's existing "resolve once per request, pass data down" server-component shape (`hours/page.tsx`, `p/page.tsx`). A single failed/expired signing degrades to "no image for that side" (both `beforeImageUrl`/`afterImageUrl` independently nullable) rather than failing the whole page — `ResultsImprovements` never requires an image to render the explanation, per this section's own explicit "must not require images to be worth reading" instruction.
- **The header line is unconditional** — when `baseline_frozen_at` is null (baseline not yet frozen), the header still renders an honest sentence saying so rather than omitting the header entirely or showing a stale/guessed date; this is the same "never fabricate, never omit the caveat" posture the rest of this feature follows.
- **Empty state only fires when BOTH metrics and improvements are empty** — a project with metrics but no improvements (or vice versa) still renders the section it has data for; each of `MetricComparisonCard`'s grid and `ResultsImprovements` independently handles its own empty case (no metrics -> the grid is simply omitted; no improvements -> `ResultsImprovements` renders its own honest "Nothing has been logged here yet." rather than an em dash or a hidden section).

## Out-of-scope work needed
- None identified beyond what F020's own handoff already flagged (GSC/GA4/Lighthouse automatic collection remains out of scope for the whole mission, not just this feature).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: the "not measured yet ... when it will be" line states the measurement METHOD (same as baseline) rather than a fabricated future DATE, since F020's schema has no cadence/next-measurement field to read one from — see "Decisions made" above for the full reasoning.

## Notes for the next worker
- No MCP tools were used — this feature touches no live schema/policy state (F020 already migrated and RLS-verified everything this page reads); all work is application code (queries already exported by F020, one new signed-url Server Action, three new client-portal components).
- `getImprovementImageSignedUrl` is a new export from `lib/actions/metrics.ts` — if a future feature needs to display improvement images anywhere else in the portal, call this instead of minting a second signed-url path against the same bucket/path convention.
