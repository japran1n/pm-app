# Handoff: F108 — Three client-portal visuals from existing data (Pages pipeline, budget bar, deliverable strip)

## Status
COMPLETE

## Assertions covered
No formal validation-contract assertion IDs were assigned to this task (no
`missions/20260903-portal/features/F108-*.md` spec exists — this was a
direct orchestrator brief referencing `docs/client-portal-visual-plan.md`
Part 0 and sections 3.2–3.4). Tests are named against the closest existing
assertions these visuals draw on:

AS-014: PASS — `PagePipeline`'s all-zero pipeline renders an honest empty state (`test_AS_014_an_all_zero_pipeline_renders_an_honest_empty_state`); the Pages route itself still short-circuits to `pages-view-empty` before ever reaching the pipeline with zero pages, so this is defence-in-depth for the component in isolation.
AS-017: PASS — `PagePipeline` renders every bucket's count in pipeline order (`test_AS_017_renders_every_step_in_order_with_its_own_count`) and highlights the client's own bucket without colour alone (`test_AS_017_highlights_the_clients_own_bucket_using_the_waiting_token_not_colour_alone`).
AS-085 (labels prop): PASS — pre-existing `status-distribution.test.tsx` (`test_AS_085_a_caller_can_supply_its_own_label_set`) still passes unchanged; Your-list's segmented strip (item 3) already reuses this exact mechanism from F014/F085.

## Files changed
components/portal/page-pipeline.tsx (new)
components/portal/page-pipeline.test.tsx (new)
components/portal/budget-bar.tsx (new)
components/portal/budget-bar.test.tsx (new)
components/portal/page-travel-strip.tsx (deleted — superseded)
components/portal/page-travel-strip.test.tsx (deleted — superseded)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/pages/page.tsx (StatusDistribution + PageTravelStrip replaced with PagePipeline)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx (BudgetBar added as its own full-width block)

## Commands run
`npx vitest run components/portal/page-pipeline.test.tsx components/portal/budget-bar.test.tsx components/portal/status-distribution.test.tsx components/portal/pages-table.test.tsx components/portal/overview-tiles.test.tsx` (0, 27 passed)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0, 1 passed)
`npx tsc --noEmit` (1 pre-existing error in `lib/actions/phases.ts`, unrelated — see Notes)
`npm run build` (fails at the TypeScript step on `lib/actions/phases.ts`, `components/project/phase-list.tsx`, `tests/integration/f002-phase-management.test.ts` — all pre-existing, unrelated to this feature; see Notes)
`curl -sS -c cookies.txt "http://localhost:3000/dev-login?email=nina@demo.test"` (307, session cookie set) then `curl -sS -b cookies.txt "http://localhost:3000/portal/acme-studio/p/fe557caa-be43-4e78-9eec-92293617edfa/pages"` (200) and the equivalent Overview URL (200) — real markup confirmed, `data-testid="page-pipeline"` and `data-testid="budget-bar"` both present, not an error boundary.
`curl -sS -c petra-cookies.txt "http://localhost:3000/dev-login?email=petra@demo.test"` (307) then `curl -sS -b petra-cookies.txt "http://localhost:3000/portal/cedarwood-partners/p/8f903494-5569-4a6a-9b35-7a40c07e60bd"` (200, Meridian Ops Dashboard's Overview) — confirmed the over-budget path renders real, non-clamped numbers: `budget-bar-summary` text is "38h used against a 20h budget — 18h over.", and `budget-bar-overage` renders with `bg-status-blocked` at `left: 51.28%, width: 46.15%` — starting exactly at the ceiling and extending well past it.

## Decisions made
- **Pages pipeline supersedes both `PageTravelStrip` and the Pages view's `StatusDistribution` bar, rather than stacking a third thing beside them.** Grepped `status-label.ts` and confirmed the real per-page data only ever resolves to the four `ClientBucket` values (`resolveClientBucket`) — there is no seven-way "which exact step" column anywhere in the schema (`lib/queries/portal.ts`'s `getPortalPages` only ever returns `category`/`client_bucket`, never a step index). The old seven-step strip (`page-travel-strip.tsx`) was a static, non-data-driven explainer with a single fixed highlight; the old distribution bar drew the same four bucket counts as a segmented bar. Both existed to answer "where are my pages" with two separate objects (a bar + a paragraph) below the table — `PagePipeline` draws the identical bucket counts as a left-to-right journey, doing both jobs in one picture, so `page-travel-strip.tsx`/`.test.tsx` are deleted and the Pages route no longer imports `StatusDistribution` at all.
- **Pipeline order is `progress → waiting → blocked → done`**, not `status-distribution.tsx`'s own `waiting, progress, blocked, done` key order — a pipeline needs a chronological read (worked on, sometimes waiting on the client, sometimes stalled, eventually done), whereas the old key's order was just a fixed list order for a legend, not a journey.
- **The client's own bucket (`waiting`) is always the highlighted step**, using the same `--status-waiting`/`--status-waiting-bg` tokens `page-travel-strip.tsx` used for its `CLIENT_STEP` — same token, same reasoning, now applied to a real count instead of a static label.
- **Budget bar is its own full-width block on Overview, not squeezed inside the "Hours used" tile.** The tile's own column is 1/3 of the page width at `lg` (`overview-tiles.tsx`'s `grid-cols-3`) — not enough room to legibly plot a ceiling mark plus, on the over-budget path, an overage segment past it with its own label. The Hours view's own burn-down chart already earns a full card for the identical reason; `BudgetBar` follows that precedent (`hours-burndown-chart.tsx` renders in its own `rounded-lg border border-border p-5` block, not inside a tile).
- **One scale, no clamp.** `BudgetBar`'s track width (`scaleMax`) always includes at minimum a 15% headroom past the ceiling, and extends further when `usedMinutes` itself exceeds that headroom, so the overage segment is drawn in `bg-status-blocked` starting exactly at the ceiling position and extending past it — never clamped back inside the track (the defect F085 fixed for the burn-down chart's own data; this is a new component but follows the same rule from the start).
- **No colour-only encoding**: every `PagePipeline` step pairs its status token with its own `lucide-react` icon (`Clock3`/`UserRound`/`AlertTriangle`/`CheckCircle2`) and its own text label (`CLIENT_BUCKET_LABELS`) — verified by asserting `querySelector("svg")` is present alongside the text in the highlighted-step test.
- **Item 3 (deliverable strip) required no new code.** Grepped the Your-list route (`app/(portal)/.../your-list/page.tsx` lines 8, 53, 147) and confirmed F014/F085 already built exactly this: a `StatusDistribution` strip above the list, using `YOUR_LIST_BUCKET_LABELS` ("Not sent yet" / "Sent, awaiting review" / "Overdue" / "Delivered and accepted") rather than the Pages vocabulary, per `StatusDistribution`'s own `labels` prop added by F085 for this exact reuse. Confirmed via `status-distribution.test.tsx`'s existing `test_AS_085_a_caller_can_supply_its_own_label_set`, which still passes unchanged.

## Out-of-scope work needed
- No live-server visual verification was possible in this session's sandbox — see Blockers/Notes below for what to check once a dev server is reachable.
- `docs/client-portal-visual-plan.md` items 3.5 (approval ageing) and 3.6 (weekly delivery rhythm) are explicitly out of scope for this task and untouched.
- The pre-existing TypeScript/build failures in `lib/actions/phases.ts`, `components/project/phase-list.tsx`, and `tests/integration/f002-phase-management.test.ts` (missing `blockedReason`/`blocked_reason` wiring) belong to the in-flight F109 (`phase-timeline.tsx` owner's) work per the mission's migration `20261031010000_f109_phase_blocked_reason.sql` already present in the working tree — not touched here, per this task's explicit "another agent owns phase-timeline.tsx" instruction.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `F108-*.md` feature spec or clarification file exists in `missions/20260903-portal/features/` or `clarifications/` — this task was delegated directly from the orchestrator's message referencing `docs/client-portal-visual-plan.md`. All implementation choices above (pipeline order, highlight rule, budget-bar placement, scale/headroom math) were derived from that plan document, the referenced source files (`status-label.ts`, `page-travel-strip.tsx`, `pages-table.tsx`, `overview-tiles.tsx`, `status-distribution.tsx`), and the stated chart rules — not from a clarification file, since none exists for this item.
AUTONOMOUS_DECISION: Used a native `title` attribute for the budget bar's per-segment hover text rather than building a new `Tooltip`-based hover layer, since the existing `Tooltip` primitive (`components/ui/tooltip.tsx`, used by `status-pill.tsx`) is built for a single trigger + content pair, not per-segment tooltips inside one bar, and the `dataviz` skill (which would normally specify the exact hover-layer pattern for this codebase) was stated as unavailable. `role="img"` + `aria-label` carries the same full summary for assistive tech regardless of hover.

## Notes for the next worker
A dev server was already running on port 3000 in this session, so I curled it directly (see Commands run above) rather than only unit-testing the components. Confirmed via markup (not visually — no browser in this sandbox):
- `/portal/acme-studio/p/fe557caa-be43-4e78-9eec-92293617edfa/pages` (nina@demo.test) returns 200 with `page-pipeline-step-{progress,waiting,blocked,done}` and `page-pipeline-count-*` all present.
- The same project's Overview returns 200 with `budget-bar-summary` = "36h used of a 100h budget." (under-budget path, no overage node rendered).
- `/portal/cedarwood-partners/p/8f903494-5569-4a6a-9b35-7a40c07e60bd` (petra@demo.test, Meridian Ops Dashboard) returns 200 with `budget-bar-summary` = "38h used against a 20h budget — 18h over." and `budget-bar-overage` at `left: 51.28%, width: 46.15%` in `bg-status-blocked` — starting at the ceiling and extending well past it, not clamped.

**Please still screenshot/measure, since I could not see pixels:**
1. The Pages view above (or any portal-enabled project with a mix of statuses) — confirm the pipeline reads left to right as four boxes (In progress → Waiting on you → Blocked → Ready to launch), the "Waiting on you" box is visually distinct (tinted border/background, not colour alone — it also carries a `UserRound` icon), each box shows an icon + count, and the page body does not scroll sideways at a typical viewport width (no horizontal scrollbar on `<body>`).
2. The Meridian Ops Dashboard Overview above — confirm visually that the red/blocked-toned overage segment sits clearly PAST a thin ceiling tick mark (not clamped flush to the bar's right edge), matching the `left`/`width` percentages confirmed via markup above.
3. In dark mode, confirm the pipeline's icons/text and the budget bar's ceiling mark/overage segment remain legible — this reuses the same `--status-*` tokens Part 5 of the plan flags as narrowly failing the dark-mode lightness band; that re-step is out of scope here but worth a visual sanity check since these two new charts lean on those tokens more directly than prior UI did.
- `PagePipeline`'s all-zero empty state (`data-testid="page-pipeline-empty"`, "No pages yet.") is currently unreachable in practice via the real route, since `pages/page.tsx` already short-circuits to its own `EmptyState` ("No pages have been shared with you yet.") before ever rendering `PagePipeline` with zero pages. It is still tested directly against the component so the component itself never divides by zero or draws a meaningless bar if reused elsewhere later.
- Deleting `page-travel-strip.tsx`/`.test.tsx` was verified with `grep -rln "page-travel-strip\|PageTravelStrip"` across the repo — the only remaining hit is this feature's own explanatory comment in `page-pipeline.tsx` referencing the old file by name for context, not an import.
