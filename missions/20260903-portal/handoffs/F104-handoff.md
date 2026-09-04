# Handoff: F104 — Rebuild the client portal "Where we are" phase timeline

## Status
PARTIAL

## Assertions covered
AS-010: PASS — `test_AS_010_primary_success_two_active_phases_render_simultaneously` and the failure/blocked/in-flight AS-010 tests all pass unchanged in behaviour (only markup/visual treatment changed).
AS-011: PASS — `test_AS_011_a_done_phase_with_completed_tasks_shows_a_count_not_a_percentage` and the zero-tasks sibling both pass; the row label, aria-label and tooltip still derive from one shared formatter.
AS-012: UNTESTED — this feature does not touch `getProjectPhases`'s `client_visible` filter; covered by F001's existing tests, not re-verified here.

## Files changed
components/portal/phase-timeline.tsx
components/portal/phase-timeline.test.tsx

## Commands run
`npx vitest run components/portal/phase-timeline.test.tsx` (0) — 23 passed (17 pre-existing + 6 new F104 tests)
`npx tsc --noEmit` (0)
`set -a; source .env; set +a; npm run build` (0)

## Decisions made
- Range end (Problem 1): replaced the `Math.max(totalDaysRaw, MIN_CHART_DAYS)` floor — which forced every short project onto a 21-day-minimum axis regardless of content — with a smaller floor (`0.6 * MIN_CHART_DAYS`, i.e. ~13 days, kept only so a one-day phase doesn't collapse the axis) plus a small fixed `RANGE_END_PAD_PX` (24px) past the last real day. This ends the plot shortly after the last phase/today, not at an arbitrary rounded week boundary, per the spec.
- In-flight line (Problem 2): `now: ...` is no longer appended to the four-fact middot line. It renders on its own `data-testid="phase-timeline-inflight"` line, full width of the label column, so the task title and blocked qualifier are never truncated together with three other facts. Kept `title=` attributes for full-text access on hover/long-press.
- Fact hierarchy (Problem 3): kept state, dates, and count together as one line (three facts, not four, since in-flight moved out) but split it into two `<span>`s: the state word keeps its own status colour + `font-semibold`; dates/count stay `text-muted-foreground`. This differentiates weight without inventing new UI chrome. The `phase-timeline-row-label` test id and its full plain-text content contract are both preserved (existing tests assert `textContent`/`title`, not exact DOM shape), so no assertion needed rewriting beyond one regex-vs-nested-span fix (see below).
- Progress fill (Problem 4): a phase with `totalClientVisibleTasks > 0` now renders two `<rect>`s — a solid done-fraction fill and a low-opacity (`opacity=0.25`) same-hue remainder — separated by `PROGRESS_GAP_PX` (2px), matching the plan's explicit "2px surface gap" instruction literally. A phase with zero client-visible tasks (nothing to fraction) keeps a single solid bar — there is no fraction to draw and drawing one would reintroduce a fake percentage.
- Expected-progress tick (Problem 5): added `computeExpectedProgress`/`isBehindExpectedProgress`, both pure and unit-tested via the rendered `data-behind` attribute. The tick draws ONLY when a phase is `active`, has both planned dates, has ≥1 client-visible task, and today falls inside its date range — never on phases the comparison doesn't apply to. "Behind" requires a >5% gap (elapsed share vs done share) to avoid flagging phases merely on pace; this margin is not in the spec and is my own choice — flagged under Autonomous decisions below. The cue is explained in both the row's `aria-label` ("behind its expected pace for today") and the tooltip ("Behind its expected pace for today."), never asserted as a fabricated status on the row label text itself.
- Legend removal (Problem 6): the `<div>` of four legend dots is deleted outright. State identity now lives only on each row's own coloured label word, matching the plan's explicit instruction and the "no colour-alone" rule (state is still printed as text, not just colour).
- Row/bar geometry (Problem 7): `ROW_HEIGHT_PX` 56→40, `BAR_HEIGHT_PX` 12→20, so the bar is now half the row height instead of roughly a fifth, and seven rows fit in less vertical space.
- Grid recessiveness: week-tick lines changed from `stroke-border` to `stroke-border/60` per the dataviz skill's "recessive grid" principle mentioned in the mission brief (the skill file itself does not exist in this repo — see Blockers).
- No new legend, no second scale: still one x-axis (days), one colour per state, thin (1–1.5px) grid/today lines vs a thicker (2px) done bar — consistent with "one scale, thin marks" even though I could not load the named skill file to check its literal checklist.
- Fixed one now-stale test assertion (`screen.getByText(/Done · .*4 of 4 done/)`) to read `screen.getByTestId("phase-timeline-row-label").textContent` instead, because the facts line is now split across nested `<span>`s and testing-library's `getByText` matches against a single text node by default — this is a mechanical adaptation to the new DOM shape, not a weakening: the same regex still has to match the same rendered string.

## Out-of-scope work needed
- Part 2–4 of `docs/client-portal-visual-plan.md` (headline on-track banner, "what we need from you" reordering, sparkline tiles, bullet charts, pipeline view, budget bar, deliverable strip, approval ageing, weekly rhythm chart) — all explicitly out of scope for this feature, which only covers Part 1.
- `docs/client-portal-visual-plan.md` Part 5 (dark-mode status token lightness-band failures) — explicitly called out as tracked separately; not touched here. My `stroke-status-blocked` use on the expected-progress tick and the tooltip's "Behind" text inherit whatever dark-mode contrast issue exists on `--status-blocked` in dark mode; I did not change that token.
- Part 4's "blocked phase has no reason field" schema gap — unchanged; the component still says "not yet started" or bare "Blocked", exactly as before.

## Blockers
BLOCKER: The task instructs "Load the `dataviz` skill before you touch the chart," but no such skill exists in this repository — `find .claude/skills` lists `connection-setup`, `mission-planning`, `task-clarification`, `worker-mcp-usage`, `discovery-questions`, `version-freshness`, `validation-contracts`, `structured-handoffs`, `model-selection` only. There is also no `missions/20260903-portal/features/F104-*.md` spec file and no `clarifications/F104-clarification.md` — this feature was assigned outside the normal mission-run pipeline. I proceeded using the seven numbered problems and their prescribed fixes given directly in the task prompt (which are detailed enough to implement against) plus the existing AS-010/011/012 assertions and this component's own prior contract, and I documented every deviation-worthy choice above and in Autonomous decisions.
TRIED: Searched `.claude/skills/*dataviz*`, `.claude/skills/*viz*`, and the full skills directory listing — no match. Searched `missions/20260903-portal/features` and `clarifications` for F104 — no match.
NEEDED: Either the orchestrator registers a `dataviz` skill under `.claude/skills/dataviz/SKILL.md` (its checklist — one scale, thin marks, recessive grid, hover layer, no legend-when-redundant, spacer rule — appears to already be reflected verbatim in this task's own prose, so the skill file's absence did not block correctness, only formal skill-loading), or confirms F104 is intentionally a direct ad hoc assignment outside `/mission-tasks`/`/mission-clarify` and a feature+clarification file should be backfilled for the audit trail.
SUGGESTED FOLLOWUP: Backfill `missions/20260903-portal/features/F104-rebuild-phase-timeline.md` and its clarification file from this handoff's Decisions/Autonomous-decisions sections so the mission's feature ledger accounts for this work, and add `.claude/skills/dataviz/SKILL.md` (referenced by name in at least this task and presumably future visual work) so subsequent visual features can load it as instructed instead of relying on prose repeated in each task description.

I also could not complete the mandatory "look at it" verification step: this worker session has no browser-driving tool available (only Read/Write/Edit/Bash), so I did not sign in as nina@demo.test and visually inspect the rendered timeline at 375px in both themes as step 7 of the (missing) dataviz skill and the task's own "Verify" section require. Everything above is verified via unit tests, `tsc`, and `next build` only — not via an actual rendered screenshot. Status is PARTIAL rather than BLOCKED because the code change itself is complete, tested, and typechecks/builds; the missing piece is purely the visual-inspection evidence artifact.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a >5 percentage-point gap between elapsed-time share and done-task share as the "behind" threshold for the expected-progress tick, rather than flagging any nonzero gap. Rationale: flagging on any gap at all would make nearly every active phase read as "behind" on any day that isn't an exact task-completion boundary, which is noisier than the spec's intent ("mark expected progress... so 'behind' reads as behind" implies a meaningful lag, not noise). The tick itself (the expected-progress mark) always renders for every eligible active phase regardless of this threshold — only the "behind" colour/aria-label upgrade is gated by it — so the spec's literal instruction ("mark expected progress with a small tick") holds unconditionally, and the derived "behind" cue only fires when the gap is real.
AUTONOMOUS_DECISION: Used a fixed small pixel pad (`RANGE_END_PAD_PX = 24`) plus a reduced day-count floor, rather than removing the floor entirely, because a floor of 0 could still produce a visually cramped single-bar chart for a one-phase, one-day project; 24px is small relative to `PX_PER_DAY * 7` (42px per week) so it reads as "shortly past the last phase," matching the spec's own wording, rather than reintroducing the dead-space defect being fixed.
AUTONOMOUS_DECISION: Kept the in-flight line's label text as `Now: <title>` (capital N, no "not yet" alternate phrasing) rather than the old lowercase `now: <title>` fragment, since it is now a standalone sentence-like line rather than a mid-string fragment; verified no test or aria-label snapshot depended on the old lowercase form (checked via `grep -n "now:" phase-timeline.test.tsx` before and after).

## Notes for the next worker
- `computePhaseTimelineLayout` and the two new pure helpers (`computeExpectedProgress`, `isBehindExpectedProgress`) are exported/kept as private pure functions respectively — only the layout function was already exported for testing per the file's existing pattern; the progress helpers are exercised indirectly through rendered `data-behind`/`phase-timeline-expected-tick` attributes, consistent with how the file already tests behaviour through the DOM rather than exporting every internal helper.
- The `--status-blocked` / `--status-progress` etc. tokens were not touched, per the constraint in the task; dark-mode contrast on two of those tokens is a known, separately tracked issue (Part 5) and this component's new "behind" tick/tooltip text will inherit it unchanged.
- No MCP tools were relevant to this feature — it is a pure client-side rendering component with no live external service state.

---

## Round 2 addendum — coordinator-observed defects fixed

The coordinator rendered the live page and reported two collisions plus a
scroll-containment question. All three are addressed in this same commit.

**Defect 1 — duplicated in-flight text.** The round-1 JSX still appended
`inFlightLine` to the facts-line `<span>` in addition to rendering it on its
own dedicated line, so it showed twice (`Now: Ho…Now: Homepage hi-fi
design`), with the first copy truncated. Fixed by deleting the appended
`<span>` from the facts line entirely — `formatInFlightLine`'s output now
renders in exactly one place, the dedicated `phase-timeline-inflight` line.
`formatPhaseSecondaryLine` (used for `aria-label` and the tooltip, not the
visible facts span) still legitimately combines both strings into one
sentence for assistive tech / hover, which is a different, single-string
context, not a duplicate on-screen line.

**Defect 2 — fixed row height caused text overflow into the next row.**
Replaced the single `ROW_HEIGHT_PX` constant with a per-row `heightPx`
(`rowHeightForPhase`): `BASE_ROW_HEIGHT_PX` (40, two lines) or
`BASE_ROW_HEIGHT_PX + INFLIGHT_LINE_HEIGHT_PX` (56, three lines) when
`formatInFlightLine` returns non-null for that phase. `computePhaseTimelineLayout`
now threads a running `yPx` offset through both branches (dateless-fallback
and dated) and returns `contentHeightPx` (sum of all row heights) on the
layout object. The label column (`layout.rows.map(({ phase, heightPx }) =>
...)`) and the SVG (`row.yPx`, `row.heightPx` for bar `y` and the
expected-progress tick; `hoveredRow.yPx + hoveredRow.heightPx` for the
tooltip's `y`) both read from these same per-row numbers, so the two
coordinate systems (text column, plot area) are derived from one source and
cannot drift apart the way the old `index * ROW_HEIGHT_PX` arithmetic could.
Added `test_F104_round2_a_rows_own_height_grows_to_fit_its_inflight_line_without_overlapping_the_next_row`,
which asserts the taller row's height, the following row's exact `yPx`
(`row1.yPx + row1.heightPx`, i.e. zero gap and zero overlap), and that the
two rendered bars land at increasing `y` in the DOM.

**Scroll containment (investigated, not just re-asserted).** Traced the
component's actual placement: `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx`
renders `<PhaseTimeline>` inside `<div className="grid gap-8
lg:grid-cols-3">` → `<div className="flex flex-col gap-8 lg:col-span-2">`.
A CSS grid track's default `min-width` is `auto`, i.e. a grid item will NOT
shrink below its content's intrinsic width unless something in the
ancestor chain sets `min-width: 0` — and nothing in the pre-round-2 markup
did. That is a plausible, structurally-verifiable explanation for "clipped
at the right edge of the viewport": the SVG's own intrinsic width could
have been sizing the grid column (and the page) instead of being contained
and scrolled by `phase-timeline-scroll`'s `min-w-0 flex-1 overflow-x-auto`.
Fixed defensively inside this component (in scope, same file) by adding
`min-w-0` to the component's own root wrapper and to the inner `flex gap-3`
row, so the component constrains its own width regardless of how its
parent grid/flex context behaves. I did not touch `page.tsx` (out of
file-scope for this handoff) — if `min-w-0` on the grid item itself
(`lg:col-span-2` div) is also needed, that is a one-line follow-up outside
this component.

I still could not render the page in a browser this session (no
browser-driving tool available) to visually confirm the clipping is gone,
or that both themes / 375px look correct — this remains the same
caveat as round 1, now narrowed to a specific, reasoned CSS fix rather
than an unexamined "should be fine."

## Commands run (round 2)
`npx vitest run components/portal/phase-timeline.test.tsx` (0) — 24 passed (23 prior + 1 new round-2 regression test)
`npx tsc --noEmit` (0)
`set -a; source .env; set +a; npm run build` (0)

## Status (round 2)
Still PARTIAL for the same reason as round 1: no browser-driving tool available this session to produce the required visual-inspection evidence artifact. The two coordinator-reported defects are fixed and covered by new/updated tests; the scroll-clipping issue has a structural fix applied and reasoned about, but is unverified by render.
