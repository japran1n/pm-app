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
components/portal/page-pipeline.tsx (new; round 2: reworked flow + wrap fix; round 3: blocked marker moved outside the scroll container)
components/portal/page-pipeline.test.tsx (new; round 2: rewritten for the new flow/marker shape; round 3: added scroll-container-isolation test)
components/portal/budget-bar.tsx (new)
components/portal/budget-bar.test.tsx (new)
components/portal/page-travel-strip.tsx (deleted — superseded)
components/portal/page-travel-strip.test.tsx (deleted — superseded)
components/portal/status-pill.tsx (round 2: added optional `labelOverride` prop, default-`null`/unchanged for every existing caller)
components/portal/pages-table.tsx (round 2: passes `labelOverride` to StatusPill; fixed the filter trigger's `__all__` sentinel leak)
components/portal/pages-table.test.tsx (round 2: updated assertions for the resolved-bucket label, added a raw-name-never-leaks test)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/pages/page.tsx (StatusDistribution + PageTravelStrip replaced with PagePipeline)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx (BudgetBar added as its own full-width block)

## Commands run
`npx vitest run components/portal/page-pipeline.test.tsx components/portal/pages-table.test.tsx components/portal/status-pill.test.tsx components/portal/status-distribution.test.tsx components/portal/budget-bar.test.tsx components/portal/overview-tiles.test.tsx tests/unit/server-client-boundary-imports.test.ts` (round 3, 0, 41 passed)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0, 1 passed)
`npx tsc --noEmit` (1 pre-existing error in `lib/actions/phases.ts`, unrelated — see Notes)
`npm run build` (fails at the TypeScript step on `lib/actions/phases.ts`, `components/project/phase-list.tsx`, `tests/integration/f002-phase-management.test.ts` — all pre-existing, unrelated to this feature; see Notes)
`curl -sS -c cookies.txt "http://localhost:3000/dev-login?email=nina@demo.test"` (307, session cookie set) then `curl -sS -b cookies.txt "http://localhost:3000/portal/acme-studio/p/<projectId>/pages"` (200) and the equivalent Overview URL (200) — real markup confirmed, `data-testid="page-pipeline"` and `data-testid="budget-bar"` both present, not an error boundary. Project ids are NOT stable across sessions (the DB was reseeded between round 1 and round 2 of this task, changing them) — always re-resolve the current one via `GET /portal/acme-studio` first.
`curl -sS -c petra-cookies.txt "http://localhost:3000/dev-login?email=petra@demo.test"` (307) then `curl -sS -b petra-cookies.txt "http://localhost:3000/portal/cedarwood-partners/p/8f903494-5569-4a6a-9b35-7a40c07e60bd"` (200, Meridian Ops Dashboard's Overview) — confirmed the over-budget path renders real, non-clamped numbers: `budget-bar-summary` text is "38h used against a 20h budget — 18h over.", and `budget-bar-overage` renders with `bg-status-blocked` at `left: 51.28%, width: 46.15%` — starting exactly at the ceiling and extending well past it.

## Decisions made
- **Pages pipeline supersedes both `PageTravelStrip` and the Pages view's `StatusDistribution` bar, rather than stacking a third thing beside them.** Grepped `status-label.ts` and confirmed the real per-page data only ever resolves to the four `ClientBucket` values (`resolveClientBucket`) — there is no seven-way "which exact step" column anywhere in the schema (`lib/queries/portal.ts`'s `getPortalPages` only ever returns `category`/`client_bucket`, never a step index). The old seven-step strip (`page-travel-strip.tsx`) was a static, non-data-driven explainer with a single fixed highlight; the old distribution bar drew the same four bucket counts as a segmented bar. Both existed to answer "where are my pages" with two separate objects (a bar + a paragraph) below the table — `PagePipeline` draws the identical bucket counts as a left-to-right journey, doing both jobs in one picture, so `page-travel-strip.tsx`/`.test.tsx` are deleted and the Pages route no longer imports `StatusDistribution` at all.
- **Pipeline order is `progress → waiting → blocked → done`**, not `status-distribution.tsx`'s own `waiting, progress, blocked, done` key order — a pipeline needs a chronological read (worked on, sometimes waiting on the client, sometimes stalled, eventually done), whereas the old key's order was just a fixed list order for a legend, not a journey.
- **The client's own bucket (`waiting`) is always the highlighted step**, using the same `--status-waiting`/`--status-waiting-bg` tokens `page-travel-strip.tsx` used for its `CLIENT_STEP` — same token, same reasoning, now applied to a real count instead of a static label.
- **Budget bar is its own full-width block on Overview, not squeezed inside the "Hours used" tile.** The tile's own column is 1/3 of the page width at `lg` (`overview-tiles.tsx`'s `grid-cols-3`) — not enough room to legibly plot a ceiling mark plus, on the over-budget path, an overage segment past it with its own label. The Hours view's own burn-down chart already earns a full card for the identical reason; `BudgetBar` follows that precedent (`hours-burndown-chart.tsx` renders in its own `rounded-lg border border-border p-5` block, not inside a tile).
- **One scale, no clamp.** `BudgetBar`'s track width (`scaleMax`) always includes at minimum a 15% headroom past the ceiling, and extends further when `usedMinutes` itself exceeds that headroom, so the overage segment is drawn in `bg-status-blocked` starting exactly at the ceiling position and extending past it — never clamped back inside the track (the defect F085 fixed for the burn-down chart's own data; this is a new component but follows the same rule from the start).
- **No colour-only encoding**: every `PagePipeline` step pairs its status token with its own `lucide-react` icon (`Clock3`/`UserRound`/`AlertTriangle`/`CheckCircle2`) and its own text label (`CLIENT_BUCKET_LABELS`) — verified by asserting `querySelector("svg")` is present alongside the text in the highlighted-step test.
- **Item 3 (deliverable strip) required no new code.** Grepped the Your-list route (`app/(portal)/.../your-list/page.tsx` lines 8, 53, 147) and confirmed F014/F085 already built exactly this: a `StatusDistribution` strip above the list, using `YOUR_LIST_BUCKET_LABELS` ("Not sent yet" / "Sent, awaiting review" / "Overdue" / "Delivered and accepted") rather than the Pages vocabulary, per `StatusDistribution`'s own `labels` prop added by F085 for this exact reuse. Confirmed via `status-distribution.test.tsx`'s existing `test_AS_085_a_caller_can_supply_its_own_label_set`, which still passes unchanged.

## Round 2 — coordinator review fixes

The coordinator reviewed the rendered Pages view as `nina` and found four
problems; addressed all four before completing this task, per its explicit
"3 and 4 are in scope now" instruction:

1. **Pipeline orphaned its last step at 808px** (wrapped, dangling arrow
   after `Blocked`). Fixed by removing `blocked` from the arrow-connected
   flow entirely (see #2) and making the remaining 3-step flow
   `flex-nowrap` inside an `overflow-x-auto` container — the same
   "scrolls inside its own container, never the page" pattern
   `hours-burndown-chart.tsx` already uses for its SVG. The strip now
   never wraps at any width; it scrolls instead.
2. **"Blocked" was drawn as a step between "Waiting on you" and "Ready to
   launch," implying pages pass through it on the way to launch — false.**
   Reworked `PagePipeline`: the arrow-connected flow is now only
   `In progress → Waiting on you → Ready to launch` (`FLOW_ORDER`), the
   three buckets that genuinely follow one another. `Blocked` renders as
   its own marker (`data-testid="page-pipeline-blocked-aside"`, labelled
   "Stuck at any step"), set apart by a plain divider rather than an
   arrow — an arrow means "leads to", a divider doesn't claim that.
3. **The table's Status column showed raw internal status names**
   (`todo`/`in_progress`/`in_review`/`done` — the default seed's own
   literal names, `supabase/migrations/20260824010000_project_statuses.sql`
   lines 63-66) directly beneath a pipeline using the correct client
   vocabulary. Fixed by adding an optional `labelOverride` prop to
   `StatusPill` (default `null` — every existing caller, including the
   team-side board, is byte-for-byte unchanged) and having `PagesTable`
   pass `CLIENT_BUCKET_LABELS[page.status.clientBucket]` — the exact
   bucket word `PagePipeline` above it already uses for the same page.
4. **The filter dropdown showed the raw `__all__` sentinel** on initial
   render. Root cause: `components/ui/select.tsx` wraps `@base-ui/react/
   select`'s `Select.Value`, which (per its own type definition,
   `node_modules/@base-ui/react/select/value/SelectValue.d.ts`) only
   mirrors a matching `Select.Item`'s rendered text once that item has
   actually mounted (i.e. after the popup has been opened at least once)
   — before that it falls back to rendering the raw `value` prop
   verbatim. Fixed by passing `SelectValue` an explicit children render
   function (`FILTER_TRIGGER_LABELS[value] ?? "All statuses"`), Base UI's
   own documented mechanism for this exact case — confirmed via
   `node_modules` inspection, not memory, since this is a live library
   behaviour, not app code.

**Live verification after the fix** (dev server was already running; DB
had been reseeded between round 1 and round 2, so project ids changed —
re-resolved via `/portal/acme-studio`):
- `GET /portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b/pages`
  → 200. Markup shows exactly 4 rendered pill labels — "Ready to
  launch", "In progress" (x2), "Waiting on you", "Blocked" — and zero
  occurrences of a raw status name text node.
- The pipeline's flow (`<ol aria-label="How your pages travel, by
  count">`) contains exactly the 3 `<li>` flow steps (progress, waiting,
  done) each followed by a `→`; `Blocked` appears only in the separate
  `data-testid="page-pipeline-blocked-aside"` block, with no arrow
  pointing into or out of it.
- The filter trigger's `<span data-slot="select-value">` renders
  `All statuses` literally in the initial server-rendered HTML — no
  `__all__` anywhere in the response body.

## Round 3 — coordinator review: blocked marker cut off at scroll position

Round 2 moved `Blocked` out of the arrow chain but left it INSIDE the same
`overflow-x-auto` scroll container as the flow, in a single flex row. The
coordinator measured this live at 808px: `clientW 504` vs `scrollW 572`, and
at the scroller's default (unscrolled) position the blocked marker's right
edge (`asideRight: 852`) sat past the 808px viewport — a client would see
"Stuck at…" and a sliver of the count, with no visible affordance (no
scrollbar styling, no fade, no arrow) signalling there was more to scroll to.
The one number a client most needs to act on was the one hidden.

**Decision: moved the blocked marker OUTSIDE the scroller entirely, into its
own always-visible row beneath the flow**, rather than adding a scroll
affordance to the existing layout. Reasoning:
- This is truer to round 2's own decision, not a bolt-on fix. Round 2
  already established "Blocked is not a step in the sequence" (no arrow
  points into or out of it). A thing that is not part of the flow has no
  principled reason to live inside the flow's OWN scroll container either —
  keeping it there was itself an inconsistency the coordinator's measurement
  just exposed at a concrete pixel value.
- A scroll affordance (a fade edge, a scrollbar, a "more →" hint) would have
  fixed the SYMPTOM (things get cut off) while leaving the cause (blocked
  travels with a scroller it conceptually has no business inside) in place.
  It would also have added a second scroll experience next to the Overview's
  phase timeline's existing horizontal scroller, more surface for the exact
  "wide content must scroll inside its own container, never the page" class
  of defect this mission has already hit twice (the tile-grid orphan; the
  phase-timeline sideways-scroll bug both prior reviews reference).
- Moving it out is also strictly simpler: no measurement, no fade mask, no
  scrollbar styling to theme for light/dark — a `border-t` divider and a
  `flex` row that never scrolls.

Implementation: the `<ol>` (the arrow-connected 3-step flow) is now the ONLY
element inside `.overflow-x-auto` — unchanged from round 2 otherwise, so it
still degrades to a horizontal scroll (never a wrapped, orphaned arrow) at
the narrowest widths, per round 2's own fix. The blocked marker sits in a
sibling `flex` row below it, separated by a `border-t border-border`
(divider, not an arrow — same semantic as round 2's divider), always
rendered regardless of the flow's scroll position or the viewport width.

**Verification**
- Unit test added: `test_F108_blocked_marker_is_never_inside_the_flows_scroll_container`
  (`page-pipeline.test.tsx`) — asserts the blocked marker is absent from
  `.overflow-x-auto`'s subtree and present elsewhere in the document.
- Live markup (re-curled after the fix, `/portal/acme-studio/p/<projectId>/pages`
  as `nina`): `.overflow-x-auto` now wraps ONLY the `<ol aria-label="How your
  pages travel, by count">` flow list; `data-testid="page-pipeline-blocked-aside"`
  is structurally a sibling of that scroller, not a descendant — confirmed by
  reading the raw HTML response (no browser/DOM measurement tool available in
  this sandbox).
- **375px was not measured directly** (no browser in this sandbox to resize
  a viewport and read computed layout/`getBoundingClientRect` the way the
  coordinator's 808px numbers were produced). Structurally, since the
  blocked marker is now outside the scroller and the scroller's own overflow
  behaviour is unchanged from round 2 (already verified safe from a sideways
  PAGE scroll — `pageSideways: false` at 808px per the coordinator's own
  round-2 confirmation, and the container is `min-w-0`-safe the same way
  `phase-timeline.tsx`'s own fix required), the blocked row itself has no
  horizontal scroll mechanism of its own and cannot be cut off by one — but
  I could not confirm this with a real 375px render. **Please measure the
  same way as before**: `asideRight` (or the blocked marker's
  `getBoundingClientRect().right`) against a 375px viewport width, and
  `document.body.scrollWidth` vs `clientWidth` to confirm no page-level
  sideways scroll was introduced by the blocked row's own `flex` layout
  (it has no `overflow-x-auto` of its own, so it should simply wrap or
  shrink, but a real measurement is the only way to be sure at that width).

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
- `/portal/acme-studio/p/<projectId>/pages` (nina@demo.test) returns 200 with `page-pipeline-step-{progress,waiting,blocked,done}` and `page-pipeline-count-*` all present (project id changes across sessions/reseeds — re-resolve via `/portal/acme-studio` first).
- The same project's Overview returns 200 with `budget-bar-summary` = "36h used of a 100h budget." (under-budget path, no overage node rendered).
- `/portal/cedarwood-partners/p/8f903494-5569-4a6a-9b35-7a40c07e60bd` (petra@demo.test, Meridian Ops Dashboard) returns 200 with `budget-bar-summary` = "38h used against a 20h budget — 18h over." and `budget-bar-overage` at `left: 51.28%, width: 46.15%` in `bg-status-blocked` — starting at the ceiling and extending well past it, not clamped.

**Please still screenshot/measure, since I could not see pixels:**
1. The Pages view above (or any portal-enabled project with a mix of statuses) — confirm the pipeline reads left to right as four boxes (In progress → Waiting on you → Blocked → Ready to launch), the "Waiting on you" box is visually distinct (tinted border/background, not colour alone — it also carries a `UserRound` icon), each box shows an icon + count, and the page body does not scroll sideways at a typical viewport width (no horizontal scrollbar on `<body>`).
2. The Meridian Ops Dashboard Overview above — confirm visually that the red/blocked-toned overage segment sits clearly PAST a thin ceiling tick mark (not clamped flush to the bar's right edge), matching the `left`/`width` percentages confirmed via markup above.
3. In dark mode, confirm the pipeline's icons/text and the budget bar's ceiling mark/overage segment remain legible — this reuses the same `--status-*` tokens Part 5 of the plan flags as narrowly failing the dark-mode lightness band; that re-step is out of scope here but worth a visual sanity check since these two new charts lean on those tokens more directly than prior UI did.
- `PagePipeline`'s all-zero empty state (`data-testid="page-pipeline-empty"`, "No pages yet.") is currently unreachable in practice via the real route, since `pages/page.tsx` already short-circuits to its own `EmptyState` ("No pages have been shared with you yet.") before ever rendering `PagePipeline` with zero pages. It is still tested directly against the component so the component itself never divides by zero or draws a meaningless bar if reused elsewhere later.
- Deleting `page-travel-strip.tsx`/`.test.tsx` was verified with `grep -rln "page-travel-strip\|PageTravelStrip"` across the repo — the only remaining hit is this feature's own explanatory comment in `page-pipeline.tsx` referencing the old file by name for context, not an import.
