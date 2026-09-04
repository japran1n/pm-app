# Handoff: F110 — Dark status-palette re-step + approval ageing bar

## Status
COMPLETE

## Assertions covered
No assertion IDs were pre-assigned to this task (it was dispatched directly
by the orchestrator, not via a `features/F110-*.md` spec/clarification pair
— no such files exist in `missions/20260903-portal/`). No `validation-contract.md`
assertions are claimed here; this is a fix + a UI addition on top of
already-covered F009/F085 surfaces. All pre-existing AS-021/022/023/025/085
tests in `components/portal/approval-card.test.tsx` still pass unchanged
(see Commands run).

## Files changed
app/globals.css
components/portal/approval-card.tsx
components/portal/approval-card.test.tsx
missions/20260903-portal/handoffs/F110-handoff.md

## Commands run
`node <dataviz>/scripts/validate_palette.js "#2f9e73,#5a86dc,#b98d28,#dd5560" --mode dark` (0) — see full output below
`npx vitest run components/portal/approval-card.test.tsx` (0) — 25 passed (21 pre-existing unchanged + 4 new F110 age-bar tests)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0) — 1 passed
`npx tsc --noEmit` (0)
`npm run build` (0)
`curl -sL http://localhost:3000/dev-login?email=nina@demo.test` (200, redirected to `/portal/acme-studio`)
`curl -s http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b/approvals` (200) — confirmed real markup with `approval-age`, `approval-age-bar`, `approval-age-bar-fill`, `approval-age-bar-due-marker` test ids present in the response HTML

## Decisions made

### Part A — dark status palette re-step
- Ran the validator on the current dark palette first to confirm the
  starting point matched what was reported:
  ```
  Palette (dark, surface #1a1a19, categorical): 4 slots
    [FAIL] Lightness band   outside band: [["#7aa5f3",0.723],["#dbb03e",0.776]]
    [PASS] Chroma floor
    [PASS] CVD separation      worst adjacent #dd5560↔#dbb03e ΔE 15.8 (deutan) · tritan 9.4
    [PASS] Normal-vision floor worst adjacent #7aa5f3↔#2f9e73 ΔE 20.8 (normal)
    [PASS] Contrast vs surface all 4 >= 3:1
  ```
- Darkened `--status-progress` (blue) from `#7aa5f3` (L 0.723) to `#5a86dc`,
  and `--status-waiting` (amber) from `#dbb03e` (L 0.776) to `#b98d28`,
  keeping hue/chroma character (still recognisably blue and amber) while
  pulling both into the lightness band. Iterated the amber down in steps
  (`#c99b2e` → `#b98d28`) because moving it into the band first surfaced a
  **new** failure — the amber got close enough to the red in hue/lightness
  that CVD separation (deutan) dropped from a comfortable 15.8 to a failing
  ΔE. Had to go one step further and check the full report at each step
  rather than stopping once lightness passed, per the instruction not to
  pick a lesser evil silently. Final value passes both:
  ```
  node validate_palette.js "#2f9e73,#5a86dc,#c99b2e,#dd5560" --mode dark
  [FAIL] Lightness band   outside band: [["#c99b2e",0.714]]   <- one more step needed
  ```
  ```
  node validate_palette.js "#2f9e73,#5a86dc,#b98d28,#dd5560" --mode dark
    [PASS] Lightness band       all 4 inside L 0.48–0.67
    [PASS] Chroma floor         all 4 >= 0.1
    [WARN] CVD separation       worst adjacent #dd5560↔#b98d28 ΔE 6.6 (deutan) · tritan 3.8
    [PASS] Normal-vision floor  worst adjacent #dd5560↔#b98d28 ΔE 16.7 (normal)
    [PASS] Contrast vs surface  all 4 >= 3:1
    → ALL CHECKS PASS  (CVD in the 6–8 floor band is legal ONLY with secondary
      encoding: direct labels, gaps, or texture)
  ```
  The CVD line is a WARN, not a FAIL, and the validator's own footer says
  this is legal *given* secondary encoding. This codebase already gives
  every status token secondary encoding wherever it distinguishes state:
  the approval due chip and the new age-bar overdue marker both pair the
  colour with an icon and explicit text ("Overdue" / "N days overdue"),
  never colour alone (grep `text-status-blocked` usage across
  `components/portal/*.tsx` — every non-decorative use is adjacent to text
  or an icon). So this WARN is acceptable as shipped rather than chased
  further into a fifth colour attempt that would risk drifting the amber
  out of "recognisably amber."
- Did not touch the light-mode block (`--status-*` under `:root`), which
  the validator already reports as passing.
- `--status-done` (green) and `--status-blocked` (red) in dark mode were
  left untouched — they were never flagged.

### Part B — approval ageing bar
- **Axis decision**: the bar's scale is "days from request to due date,"
  not open-ended elapsed time. Fill width = `daysWaited / totalSpanDays`
  (days from `requestedAt` to `dueAt`), clamped to 100%, with the due date
  pinned at the fixed right edge of the track. This means "the fill
  reaches the marker" always means "at or past due," and once genuinely
  overdue the fill is recoloured to `bg-status-blocked` (the same token
  the due chip above it already uses for overdue) **and** a fixed text
  line + `AlertTriangle` icon ("N days overdue") appears — never colour
  alone, satisfying the "no colour-only encoding" chart rule and avoiding
  the exact trap named in the brief (an overdue item reading as "full" /
  complete).
- **No-due-date guard**: renders only the "Waiting N days" text line, no
  bar at all — there's no second point to build an honest scale against,
  and fabricating one (e.g. an arbitrary max-days ceiling) would imply
  precision the data doesn't have. This replaces the prior "renders
  nothing at all" behaviour with an honest partial: still no bar, but no
  longer silent about how long it's been sitting.
- **Raised-today guard**: `daysWaited` floors at 0 via
  `Math.max(0, daysBetween(...))` and renders "Raised today" instead of
  "Waiting 0 days." `totalSpanDays <= 0` (a due date on/before the request
  date — malformed data) is guarded separately to avoid a divide-by-zero:
  falls back to a fully-elapsed (100%) fraction rather than `NaN`.
  `daysBetween` collapses both timestamps to UTC calendar midnight before
  differencing, same convention `formatDate` on this file already
  documents for the date-only `dueAt` column, so day counts don't shift
  with the client's local time zone or `requestedAt`'s time-of-day.
- **2px surface gap**: implemented as a `box-shadow: 0 0 0 2px var(--card)`
  halo around the due-date marker rather than literal spacing, so the
  marker always reads as visually separate from the fill regardless of
  how close the fill's edge gets to it — the card's own surface colour
  token, `--card`, keeps this correct in both themes without new CSS.
- **Legend**: not added — this is one fill + one fixed reference marker on
  a single scale, not two-or-more independent series, so the "legend only
  where two or more series exist" rule doesn't apply.
- **Hover target**: wrapped the 6px-tall visual track in a 16px-tall
  flex wrapper (`h-4` vs the mark's `h-1.5`) carrying a native `title`
  attribute mirroring the `aria-label`, so the hoverable/tooltip-bearing
  area is larger than the thin visual mark itself.
- Bar is gated on `!settled` (same as the existing due chip) — once a
  decision is recorded the settled block below already shows what
  happened and when; an age-since-request bar would be stale information
  competing with that.
- Did not touch `components/portal/page-pipeline.tsx`,
  `overview-tiles.tsx`, `budget-bar.tsx`, or the portal Overview page —
  confirmed via `git status`/`git diff` before and after that none of
  these were modified.

## Out-of-scope work needed
- The dark-mode `[WARN]` on CVD separation between `--status-waiting` and
  `--status-blocked` (ΔE 6.6, deutan) is in the "legal with secondary
  encoding" band per the validator's own footer, and this codebase already
  supplies that encoding everywhere these tokens appear non-decoratively.
  If a future pass wants to clear the WARN outright (not just satisfy its
  condition), that needs a wider hue re-step across both amber and red
  together, which risks drifting one or both out of "recognisably the
  same colour" — flagging rather than doing silently, per this task's own
  instruction.
- No spec/clarification files exist for "F110" under
  `missions/20260903-portal/features/` or `clarifications/` — this task
  was dispatched directly by the orchestrator's message rather than
  through the usual clarified-spec pipeline. If this mission's tracking
  expects a `features/F110-*.md` + `validation-contract.md` assertion IDs
  for this work, those should be backfilled by the orchestrator; nothing
  here should be read as claiming assertion IDs that don't exist.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "days from request to due date" as the bar's
axis (rather than e.g. a fixed 14/30-day window) because it's the only
scale for which "reached the due-date marker" and "is now overdue" are
the same fixed point on the axis — any open-ended-elapsed-time axis makes
an overdue item's fill position depend on how long ago it went overdue,
which is exactly the "overdue reads as complete" failure mode called out
in the brief.

AUTONOMOUS_DECISION: Left the dark-mode CVD separation check at WARN
(not chased to a clean PASS) because the validator's own message states
WARN-band CVD is legal given secondary encoding, and this codebase already
applies that encoding (icon + text) to every non-decorative use of these
tokens, including the new age-bar overdue state. Documented as
out-of-scope rather than silently accepted without justification.

## Notes for the next worker
- Palette validator lives at
  `/private/tmp/claude-501/bundled-skills/2.1.258/71762466150fc96949cc63a78b9fb4d9/dataviz/scripts/validate_palette.js`
  — run as `node <path> "#hex,#hex,#hex,#hex" --mode dark` (or `--mode
  light`). No `--help`; just pass the four hexes positionally.
- Dev server was already running on :3000; used `/dev-login?email=nina@demo.test`
  → redirects to `/onboarding` → `/portal/acme-studio` →
  `/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b/approvals` to
  reach a real approvals page with seeded data.
- **Screenshot request for the user** (I have no browser, only curl):
  1. Open `http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b/approvals`
     signed in as `nina@demo.test` (visit `/dev-login?email=nina@demo.test`
     first in the same browser session), in **dark mode**, and screenshot
     the open-approvals list so I can see:
     - the age bar under an approval that has a due date in the future
       (amber fill, short of the due marker),
     - the age bar under an approval that's past its due date (red/blocked
       fill, "N days overdue" text + warning icon, not just colour),
     - an approval with no due date, to confirm it shows only the "Waiting
       N days" text line and no bar.
  2. The same page in **light mode**, to confirm the (unchanged) light
     palette still reads correctly against the new bar.
  3. Any board/status view that surfaces `bg-status-progress` /
     `bg-status-waiting` in dark mode (e.g. the Pages pipeline or a task
     board column, if convenient) to eyeball that the re-stepped blue and
     amber still read as "blue" and "amber" against the dark surface, not
     washed toward grey.
