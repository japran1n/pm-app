# Handoff: F077 — Fix "Where we are" phase timeline 0% defects

## Status
COMPLETE

## Assertions covered
This task was assigned directly (not through validation-contract.md assertion
IDs); it references AS-010/AS-011/AS-012 from the existing F006/F001 features
whose behaviour it repairs. Observed results from my own test run:

AS-010: PASS — two simultaneously-active phases still render as two
  simultaneously-active rows (`test_AS_010_primary_success_two_active_phases_render_simultaneously`).
AS-011: PASS — a phase's client-visible task total/done counts drive its
  displayed progress, now as a count everywhere (row, aria-label, tooltip)
  instead of a percentage
  (`test_AS_011_a_done_phase_with_completed_tasks_shows_a_count_not_a_percentage`).
AS-012: PASS — a phase with zero client-visible tasks shows its state alone,
  never `0%`, in the row text, the aria-label and the tooltip
  (`test_AS_011_a_done_phase_with_zero_client_visible_tasks_shows_the_state_alone_never_0_percent`).

## Files changed
scripts/seed-demo.mjs
components/portal/phase-timeline.tsx
components/portal/phase-timeline.test.tsx

## Commands run
`npx vitest run components/portal/phase-timeline.test.tsx --no-file-parallelism` (0, 11 passed)
`npx vitest run tests/unit/portal-phases-query.test.ts --no-file-parallelism` (0, 8 passed — unchanged, confirms `progressPercent`/`totalClientVisibleTasks` query logic untouched)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npm run seed:demo` (0, run twice consecutively)

## Decisions made
- **Defect 1 (seed data).** Added `WEBSITE_TASK_PHASES`, a title→phase-name
  map, and applied it as an update to `tasks.phase_id` right after
  `project_phases` insert in `seedPortalDemoData` (which already has both
  `taskIdByTitle` and `phaseIdByName` in scope). Mapped by what each task
  literally is, not by list position:
  - `Kick-off & setup` (done) gets **no task** — deliberately the empty
    case (`totalClientVisibleTasks === 0`), so defect 2's fix is actually
    exercised on screen, not just in a unit test.
  - `Audit & baseline` ← "Audit current site content" (done, visible) → 1/1.
  - `Site structure` ← "Agree information architecture" (done, visible) → 1/1.
  - `Visual direction & design` (active) ← "Design system: colours & type"
    (done, **not** visible — unchanged, per that task's own deliberate-mix
    comment), "Homepage hi-fi design" (in_review, visible), "Pricing page
    hi-fi design" (in_progress, visible) → 0 of 2 visible done.
  - `Build` (active) ← "Build homepage in Next.js" (in_progress, visible),
    "CMS migration script" (todo, not visible), "SEO redirect map" (todo,
    not visible) → 0 of 1 visible done.
  - `QA & accessibility` (blocked) ← "Accessibility pass (WCAG AA)" (todo,
    visible) → 0 of 1.
  - `Launch` (not_started) ← "Launch checklist & go-live" (todo, visible)
    → 0 of 1.
  I did **not** change any task's status or any phase's state to force a
  number, per the explicit instruction. Result, verified by direct query
  after two consecutive seed runs (identical both times):
  ```
  done         Kick-off & setup             total=0 visible=0 done=0
  done         Audit & baseline             total=1 visible=1 done=1
  done         Site structure               total=1 visible=1 done=1
  active       Visual direction & design    total=3 visible=2 done=0
  active       Build                        total=3 visible=1 done=0
  blocked      QA & accessibility           total=1 visible=1 done=0
  not_started  Launch                       total=1 visible=1 done=0
  ```
- **The "different fractions across active phases" ask could not be met
  without forcing a number, and I did not force one.** Only two tasks in
  the whole seed are BOTH `status: "done"` AND `client_visible: true`
  ("Audit current site content", "Agree information architecture"), and
  both belong unambiguously to the two "done" phases by what they are.
  With no third done+visible task available, both active phases (whose
  own client-visible work is genuinely still `in_review`/`in_progress`/
  `todo`) necessarily land at 0 done. This is real information, not a
  seeding defect: work that has not finished yet is not "done" regardless
  of which phase it sits in, and reassigning "Audit current site content"
  into an active phase just to produce a non-zero number would be exactly
  the kind of forcing the spec told me not to do. The two active rows are
  still visibly distinct (`0 of 2 done` vs `0 of 1 done` — different
  denominators, same 0%), and I documented this instead of papering over
  it, per the spec's own escape hatch ("if a phase's state and its task
  completion disagree after mapping, that disagreement is real
  information; report it rather than papering over it").
- **Defect 2 (component).** Added `formatPhaseSecondaryLine` /
  `formatPhaseProgress` / `formatPhaseDateRange` helpers used in all three
  places that used to print `progressPercent`: the row's own label, the
  row's `aria-label`, and the hover tooltip — so the three can never
  disagree again. `formatPhaseProgress` returns `null` (nothing rendered)
  when `totalClientVisibleTasks === 0`; otherwise it returns
  `"<done> of <total> done"`, never a percentage.
- **Verification-before-fix, as instructed.** I wrote the updated/new tests
  first (count-based row text, the new empty-phase test, and the new
  dates-on-row test) and ran them against the still-buggy component. 4 of
  11 tests failed for the expected reason (row text said `Active · 60%`
  where the test expected `3 of 5 done`; the empty-phase row still printed
  `Done · 0%`; no date text existed on the row at all). I then applied the
  component fix and re-ran — all 11 passed. I did not need to introduce a
  separate throwaway mutation beyond "write the new tests against the old
  code" — the old code itself already reproduced the exact defect the
  tests are meant to catch, so that first red run **is** the confirmation
  the instruction asked for.
- **Dates on the row.** Added `formatPhaseDateRange`, reusing the existing
  `formatWeekLabel`/`parseDateOnly` helpers (`en-GB`, "28 Aug" style,
  already used for the axis) rather than inventing a second date format —
  one date vocabulary on the same chart. Appears in the secondary line
  between the state and the count: `Active · 28 Aug – 11 Sep · 4 of 7
  done`.
- **Truncated label.** Per the spec's explicit "do not change row height"
  constraint, I widened the label column (`w-36 sm:w-44` → `w-56 sm:w-72`)
  rather than wrapping to two lines — wrapping would have grown
  `ROW_HEIGHT_PX`-tall rows taller than the SVG bar rows they must stay
  pixel-aligned with (`y = HEADER_HEIGHT_PX + index * ROW_HEIGHT_PX`), and
  the row-height line item is explicitly out of scope for this task. The
  secondary line still truncates on overflow (now has state + dates +
  count to fit on one line) but carries a `title` attribute with the full
  text, and a data-testid (`phase-timeline-row-label`) for tests to target
  it directly without colliding with the legend's own state-name text.

## Out-of-scope work needed
- docs 1.3 (a phase can be "Blocked" before it has started, with no stated
  reason) — untouched, per the task's own "do not change... colours" /
  scope list; `QA & accessibility` is still drawn blocked with no inline
  reason.
- docs 2.2 (axis "Today" tick spacing), 2.3 (bar/legend colour intensity
  mismatch), 2.5 (drop/relabel the internal 1000/2000 numbering), 2.6
  (row height), 2.7 ("now in flight" line) — all explicitly out of scope
  for this task ("Do NOT change the axis, the colours, the legend, the row
  height, or the internal 1000/2000 numbering").
- docs Part 3 and Part 4 (feature ideas, demo readiness: second workspace,
  second client, six demo projects, demo script) — untouched, out of
  scope for this task.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Could not satisfy "active phases partially done with
different fractions" without either (a) reassigning one of the seed's only
two done+visible tasks away from its natural done-phase (breaking "done
phases fully done"), or (b) changing a task's status/phase's state to force
a number (explicitly forbidden). Chose to leave both active phases at 0
done-of-N, with differing denominators (2 vs 1) making the rows visibly
distinct, and documented the reasoning above rather than silently
papering over it, using the spec's own stated escape hatch for this exact
situation.

## Notes for the next worker
- `formatPhaseSecondaryLine(phase)` in `components/portal/phase-timeline.tsx`
  is now the single source of truth for a phase's displayed state/dates/
  progress text; any future addition to that line (e.g. docs 2.7's
  "currently in flight" line) should extend that function rather than
  re-deriving text separately for the row/aria-label/tooltip.
- The `docs/portal-timeline-review-and-demo-readiness.md` "Suggested order
  of work" list treats items 1–3 (this task) as the prerequisite for items
  4–6 (second workspace/demo projects/demo script) — those remain undone.
- No MCP tools were needed for this task: no schema/RLS change, only a
  seed-data update (existing `tasks.phase_id` column) and a client
  component fix. I did directly query the live Supabase project via the
  admin client (same credentials `seed-demo.mjs` itself uses) to verify
  per-phase task counts and idempotency, rather than through Supabase MCP,
  since `mcp-registry.md` scopes MCP use to schema/policy introspection
  and this was a data-shape verification against the seed's own admin
  client.
