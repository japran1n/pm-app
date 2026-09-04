# Handoff: F089 — "Where we are" phase timeline, remaining presentation items

## Status
COMPLETE

## Assertions covered
This task was assigned directly (not through the normal per-feature
assertion pipeline — no `features/F089-*.md` exists in this mission). It
extends AS-010 (`components/portal/phase-timeline.tsx` chart) and AS-011
(count-not-percentage), both already covered by
`phase-timeline.test.tsx`. No new assertion IDs were created; existing
tests for those IDs still pass, and new tests were added under the same
naming convention (`test_AS_010_*`) for the new behaviour introduced
here.
AS-010: PASS — 22/22 tests pass across `phase-timeline.test.tsx` and
`tests/unit/f087-a11y-perf-audit.test.tsx`.
AS-011: PASS — count-not-percentage tests unchanged and passing.

## Files changed
components/portal/phase-timeline.tsx
components/portal/phase-timeline.test.tsx
lib/queries/portal.ts
tests/unit/f087-a11y-perf-audit.test.tsx

## Commands run
`npx vitest run components/portal/phase-timeline.test.tsx` (0)
`npx vitest run tests/unit/f087-a11y-perf-audit.test.tsx components/portal/phase-timeline.test.tsx` (0)
`npx vitest run tests/unit/portal-phases-query.test.ts tests/unit/portal-overview-queries.test.ts` (0)
`npx tsc --noEmit` (0)
`npm run build` (0)

## Decisions made
- **2.2 "Today" axis fix — already done, no change needed.** Reading the
  component (not the doc, which predates today's other fixes), `Today`
  is already rendered as its own `<text>` on the dashed rule
  (`data-testid="phase-timeline-today"`), separate from `weekMarks`,
  which only ever contains real week-boundary labels at an even
  fortnightly cadence. Added a regression test
  (`keeps 'today' out of the week-tick sequence`) asserting `weekMarks`
  never contains a `"Today"` label and tick spacing is uniform, so this
  can't silently regress.
- **2.3 One state, one colour — lifted the bars, not the legend.** Each
  row used to draw two overlapping `<rect>`s: a pale `STATE_TRACK_CLASS`
  track at full width, plus a saturated `STATE_FILL_CLASS` fill sized to
  `progressPercent`. Replaced both with a single solid `<rect>` in
  `STATE_FILL_CLASS` (the same class values the legend dots already
  use), full row width. Rationale for lifting rather than calming: (a)
  the prompt says these bars carry the client's read of the whole
  project and should not be the quietest thing on the page; (b) a
  partial-width fill inside the bar would have silently re-introduced a
  percentage encoding in the *chart* even after 1.2/2.1 removed it from
  the *text* — same self-contradiction risk, just moved into pixels
  instead of characters. Completion is stated as a count on the row's
  own text line instead.
- **2.5 Dropped the `{phase.position}.` prefix, not the ordering.**
  Confirmed at `lib/queries/portal.ts` (`getProjectPhases`,
  `.order("position")`) that `position` genuinely does double duty as
  both the DB sort key and (until now) the displayed prefix. Removed
  only the display of the raw value; the query's `.order("position")`
  and the phases array's resulting row order are untouched, so the
  client-visible sequence is unchanged, only the "1000." label is gone.
- **2.6 Row height 44px → 36px, bar 16px → 12px.** Two text lines at
  `text-sm`/`text-xs` read comfortably at 36px total row height. Row
  height stays above the 24px WCAG 2.5.8 minimum target size guidance
  with margin. (Note: the actual pointer/keyboard hit target is the SVG
  `<g role="button">`, whose height is `BAR_HEIGHT_PX`, not
  `ROW_HEIGHT_PX` — that was true before this change too and is
  unchanged by it; not in this task's scope to touch.)
- **1.3/2.5 blocked-phase reason.** Checked `PortalPhase` /
  `project_phases` and the seed data for a blocker-reason field: none
  exists. `client_description` on "QA & accessibility" ("Cross-browser,
  cross-device, and WCAG AA testing before launch.") describes what the
  phase covers, not why it's blocked, so showing it as a "reason" would
  be dishonest. No linked `approval_requests`/`client_deliverables` row
  carries a blocker reason for this phase either (checked
  `scripts/seed-demo.mjs`, no `phase_id` link from either table to the
  QA phase's blocked state specifically). Per the instruction not to
  invent a field: instead of a fabricated reason, the row now uses data
  it already has — `actualStart` — to distinguish "blocked and has never
  actually started" (appends "not yet started" to the secondary line)
  from "blocked after having started" (bare "Blocked", a real live
  stoppage). This removes the false "something is actively wrong right
  now" implication for a phase that's scheduled entirely in the future,
  without inventing a reason nobody gave us.
- **2.7 In-flight line, appended not stacked.** Added
  `PortalPhase.inFlightTaskTitle` (nullable), populated in
  `getProjectPhases` from the same `tasks` query already run for the
  progress count (added `title, position` to the `select`), picking the
  client-visible `in_progress` task with the lowest `position` per
  phase — deterministic, not invented. Rendered as `· now: <title>`
  appended to the existing one-line secondary text (row label + aria-
  label + tooltip, still one shared formatter) rather than as a new row,
  so every row keeps the same fixed `ROW_HEIGHT_PX` and the 2.6 rhythm
  fix isn't undone by variable-height active rows.
- Kept `role="group"` (was already fixed by a prior feature, F087, per
  `tests/unit/f087-a11y-perf-audit.test.tsx`'s own header comment) — the
  stale `role="img"` test still living in `phase-timeline.test.tsx` was
  updated to assert `role="group"` instead, matching the code and the
  F087 fix, rather than weakened or deleted.

## Out-of-scope work needed
- The SVG row's actual pointer/keyboard hit target is `BAR_HEIGHT_PX`
  (12px) tall, not the full `ROW_HEIGHT_PX` (36px) row — pre-existing,
  not touched here, but worth a follow-up to wrap each row's hit area in
  a full-row-height transparent rect if hover/focus ergonomics on the
  bars becomes a complaint.
- Part 3 (feature ideas: "what we need from you", expected-vs-actual,
  per-phase changelog, ETA confidence, risk register, PDF export) and
  Part 4 (demo readiness: second workspace, second client, seed
  projects, demo script) from the same doc are explicitly out of scope
  for this task and untouched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to append the in-flight text to the existing
secondary line rather than render it as a distinct third line under
active phases, to keep every row's SVG bar position and row height
uniform (required by 2.6's own "tighten the vertical rhythm" goal,
which a variable-height active row would have undone). The prompt's "one
line per phase" wording is satisfied literally either way; this reading
also keeps the row-label/aria-label/tooltip-share-one-formatter
invariant intact for free.

AUTONOMOUS_DECISION: For the blocked-but-not-started case, appended
"not yet started" (lowercase, joined by the same " · ") rather than
inventing UI chrome (e.g. an icon or a differently-worded chip), so the
one shared formatter (row label / aria-label / tooltip) keeps producing
one string all three read from, per this task's own "keep everything
that landed today" instruction.

## Notes for the next worker
- `lib/queries/portal.ts`'s `getProjectPhases` now also selects
  `title, position` from `tasks` (previously `id, phase_id, status_id,
  status`) — no RLS/visibility change, same `client_visible = true`
  filter, so no new data exposure.
- I could not drive a browser in this session (no browser-automation
  tool was available to me) — I did not visually verify sign-in as
  `nina@demo.test` in Chrome/at 375px/both themes, only confirmed the
  dev server responds 200 on `/`. Recommend the orchestrator or a
  follow-up UX-validator pass actually look at the rendered page before
  calling this demo-ready, per the mission's own UX-validator step.
- No MCP tools were used — this is a pure UI/query change with no live
  schema or remote-config touch; `mcp-registry.md` was not consulted
  since nothing here changes Supabase schema or policies.
