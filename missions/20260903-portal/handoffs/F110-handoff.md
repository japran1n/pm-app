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
(see Commands run). This handoff supersedes my own earlier version of
itself for Part A: the coordinator reviewed the first palette fix and
found it traded away CVD separation it shouldn't have; Part A below is the
corrected version, with both attempts' validator output shown.

## Files changed
app/globals.css
components/portal/approval-card.tsx
components/portal/approval-card.test.tsx
missions/20260903-portal/handoffs/F110-handoff.md

## Commands run
`node validate_palette.js "#2f9e73,#7aa5f3,#dbb03e,#dd5560" --mode dark` (1) — starting point, FAIL on lightness band, full output in Decisions made
`node validate_palette.js "#2f9e73,#5a86dc,#b98d28,#dd5560" --mode dark` (0) — first (reverted) pass, ALL CHECKS PASS but CVD WARN at ΔE 6.6 — not shipped
`node validate_palette.js "#2f9e73,#7aa5f3,#c78605,#dd5560" --mode dark` (1) — control run proving blue alone (unmoved) fails the band independent of amber
`node validate_palette.js "#2f9e73,#2d75a9,#996c1a,#dd5560" --mode dark` (0) — final, shipped: ALL CHECKS PASS, CVD is a genuine PASS (ΔE 8.1), not a WARN
`node validate_palette.js "#12784f,#3670e1,#b57a00,#b8332a" --mode light` (0) — light palette re-confirmed untouched/passing after Part A changes
`grep -n "const BAND" validate_palette.js` (0) — confirmed dark band is [0.48, 0.67], not the light band's [0.43, 0.77] the brief quoted
`node -e '... validate(["#2f9e73","#7aa5f3","#2f9e73","#2f9e73"], {mode:"dark"}) ...'` (0) — isolated proof that #7aa5f3 alone is 0.053 over the dark ceiling
`npx vitest run components/portal/approval-card.test.tsx components/portal/budget-bar.test.tsx components/portal/deliverable-row.test.tsx components/portal/page-pipeline.test.tsx components/portal/metric-comparison-card.test.tsx tests/unit/server-client-boundary-imports.test.ts` (0) — 6 files, 54 passed
`npx tsc --noEmit` (0)
`npm run build` (0)
`curl -sL http://localhost:3000/dev-login?email=nina@demo.test` (200, redirected to `/portal/acme-studio`)
`curl -s http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b/approvals` (200) — confirmed real markup with `approval-age`, `approval-age-bar`, `approval-age-bar-fill`, `approval-age-bar-due-marker` test ids present in the response HTML

## Decisions made

### Part A — dark status palette re-step (revised after coordinator review)

**Correction to my first pass, and to the brief that started it:** the brief
described the target band as "L 0.43–0.77." That is the validator's
**light-mode** band. The dark-mode band the validator actually enforces
(`BAND.dark` in `validate_palette.js`) is **[0.48, 0.67]** — narrower, and
with a lower ceiling. Checked directly against the source:

```
grep -n "const BAND" validate_palette.js
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
```

Two consequences of that correction:

1. `#dbb03e` (amber) at L 0.776 was not "0.006 over a 0.77 ceiling" — it was
   0.106 over the real 0.67 ceiling.
2. `#7aa5f3` (blue) at L 0.723 was **not already inside the band** — it was
   0.053 over the same 0.67 ceiling. Confirmed by isolating it from the
   other three (which the validator would otherwise also flag independently):
   ```
   node -e '... validate(["#2f9e73","#7aa5f3","#2f9e73","#2f9e73"], {mode:"dark"}) ...'
   ["Lightness band", false, "outside band: [[\"#7aa5f3\",0.723]]"]
   ```
   So my first pass's premise — that blue needed to move at all — was correct;
   what was wrong was treating the *amber* move as the one that cost the
   separation. Re-tested that directly: reverting blue to `#7aa5f3` and
   moving only the amber still fails on blue alone, confirming blue's move
   was never optional:
   ```
   node validate_palette.js "#2f9e73,#7aa5f3,#c78605,#dd5560" --mode dark
   [FAIL] Lightness band   outside band: [["#7aa5f3",0.723]]
   [WARN] CVD separation   worst adjacent #dd5560↔#c78605 ΔE 7.9 (deutan) · tritan 9.4
   ```

**What actually cost the separation** was not "blue moved instead of amber"
— it was that my first pass moved the amber roughly to the *middle* of the
band (L≈0.64), which brought it close enough to the fixed red
(`#dd5560`, never allowed to move) in lightness/hue space to collapse
deuteranopic separation from a comfortable ΔE 15.8 down to a WARN-band 6.6.
The coordinator's instruction to treat separation as the thing to protect,
and to check what the minimum move actually is, was the right diagnosis —
just aimed at the wrong culprit (amber's *position in the band*, not
whether blue moved).

**Search approach**: rather than hand-picking further hex values, wrote a
one-off script (deleted after use, not committed) that called the
validator's own exported `validate()` function across a grid of
HSL-generated amber/blue candidates, filtering for a genuine `ok: true`
(no hard FAIL) and reading the reported deutan/tritan ΔE and normal-vision
ΔE out of the report strings. This let me search hundreds of candidates
against the validator itself instead of guessing hexes one at a time. Key
finding: **amber's position within the band, not just "in vs. out," drives
the separation from red** — the closer amber sits to the band's lighter
end, the more it converges with red under deuteranopia; the darker end of
the band (L≈0.35–0.36 in this hue) recovers full separation. Below L≈0.34
the amber starts reading as brown rather than amber (confirmed by checking
HSL: saturation stays high, ~70–80%, but at L<34% the swatch is
indistinguishable from a dark bronze in casual viewing) so I did not chase
lower values even though they scored marginally higher on deutan ΔE.

Three runs, in order:

```
# 1. Starting point (unchanged from before this task)
node validate_palette.js "#2f9e73,#7aa5f3,#dbb03e,#dd5560" --mode dark
[FAIL] Lightness band       outside band: [["#7aa5f3",0.723],["#dbb03e",0.776]]
[PASS] Chroma floor          all 4 >= 0.1
[PASS] CVD separation        worst adjacent #dd5560↔#dbb03e ΔE 15.8 (deutan) · tritan 9.4
[PASS] Normal-vision floor   worst adjacent #7aa5f3↔#2f9e73 ΔE 20.8 (normal)
[PASS] Contrast vs surface   all 4 >= 3:1

# 2. My first (reverted) pass — clears the band but costs separation
node validate_palette.js "#2f9e73,#5a86dc,#b98d28,#dd5560" --mode dark
[PASS] Lightness band        all 4 inside L 0.48–0.67
[PASS] Chroma floor          all 4 >= 0.1
[WARN] CVD separation        worst adjacent #dd5560↔#b98d28 ΔE 6.6 (deutan) · tritan 3.8
[PASS] Normal-vision floor   worst adjacent #dd5560↔#b98d28 ΔE 16.7 (normal)
[PASS] Contrast vs surface   all 4 >= 3:1
→ ALL CHECKS PASS (WARN does not fail the run, but this is the trade the
  coordinator flagged as wrong — kept here only to show the delta.)

# 3. Final: amber moved to the low end of the band instead of the middle,
#    blue re-picked alongside it (same grid search, optimising for deutan
#    ΔE with normal-vision margin >= 1.0 above the 15.0 hard floor)
node validate_palette.js "#2f9e73,#2d75a9,#996c1a,#dd5560" --mode dark
[PASS] Lightness band        all 4 inside L 0.48–0.67
[PASS] Chroma floor          all 4 >= 0.1
[PASS] CVD separation        worst adjacent #dd5560↔#996c1a ΔE 8.1 (deutan) · tritan 8.4
[PASS] Normal-vision floor   worst adjacent #dd5560↔#996c1a ΔE 16.1 (normal)
[PASS] Contrast vs surface   all 4 >= 3:1
→ ALL CHECKS PASS (CVD is a genuine PASS here, not a WARN — 8.1 clears the
  validator's own 8.0 target, not just its 6.0 floor.)
```

**Shipped values**: `--status-progress: #2d75a9` (from `#7aa5f3`),
`--status-waiting: #996c1a` (from `#dbb03e`), both in the dark-mode block
only. `--status-done` and `--status-blocked` in dark mode are untouched —
never flagged. The light-mode block (`:root`) is untouched and still
reports `ALL CHECKS PASS` (re-ran it after finishing Part A to confirm; see
Commands run).

**Trade acknowledged**: `#996c1a` is a noticeably deeper/darker amber than
the light-mode counterpart (`#b57a00`) and than my reverted first attempt —
this is the real cost of holding deutan separation at genuine-PASS rather
than floor-legal. It reads as a deep gold/ochre rather than a bright amber
chip. I judged this an acceptable trade given the coordinator's explicit
instruction to protect separation over convenience, and confirmed via the
grid search that no combination at a lighter L than ~0.35 (in this hue,
with this fixed red) clears the 8.0 deutan target while also keeping
tritan ≥ 6.0 and the normal-vision floor with a safety margin ≥ 1.0 above
15.0 — see the search transcript summary below. It was not necessary to
accept a band miss or fall back to the WARN-band value: a genuine
all-PASS combination exists, so that's what shipped.

```
# Grid-search summary (script not committed — ad hoc, run via `node -e`
# against the validator's own exported validate()):
# - Amber L >= 0.36 (any hue 33-46°, sat 60-100%, paired against blue
#   swept across hue 205-226°, sat 50-90%, L 42-66%): zero combinations
#   reach deutan >= 8.0 while also holding tritan >= 6.0 and normal-vision
#   margin >= 16.0 (i.e. >= 1.0 above the hard floor).
# - Amber L = 0.35 is the practical ceiling where such combinations start
#   to exist; #996c1a / blue #2d75a9 was the best-margined pick found
#   there (deutan 8.1, tritan 8.4, normal 16.1).
```
Also updated the code comment directly above these two variables in
`app/globals.css` to record the real dark-mode band, why blue needed to
move independent of amber, and the separation trade-off, so the next
person reading this file doesn't have to reconstruct this from git blame.

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
- (Resolved, kept for the record) The dark-mode CVD WARN from my first
  pass (ΔE 6.6 between `--status-waiting` and `--status-blocked`) is fixed
  in the shipped palette (ΔE 8.1, genuine PASS) — see Part A above. No
  outstanding WARN remains on either mode's palette.
- `--status-waiting` in dark mode (`#996c1a`) is a visibly deeper/darker
  amber than its light-mode counterpart (`#b57a00`) — this is the real
  cost of holding CVD separation at genuine-PASS rather than floor-legal
  against the fixed `#dd5560` red. If a future design pass wants a lighter
  dark-mode amber, that requires either loosening the CVD separation
  target back down (a product/accessibility call, not mine to make
  unilaterally) or re-deriving a different fixed red, which is out of this
  task's scope (`--status-blocked` was never flagged and I was told not to
  touch colors that weren't failing).
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

AUTONOMOUS_DECISION: (superseded) My first pass left the dark-mode CVD
check at WARN (ΔE 6.6), reasoning that WARN-band separation was legal given
this codebase's existing icon+text secondary encoding. The coordinator
reviewed that trade and rejected it: separation should be protected, not
merely kept legal, given how hard these tokens are now leaned on. Revised
per that feedback — the shipped palette reaches a genuine PASS (ΔE 8.1),
achieved by moving the amber to the low end of the lightness band rather
than its middle, not by accepting the WARN. Full before/after validator
runs are in Part A above.

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
