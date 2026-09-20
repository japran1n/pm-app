# M8 UX Validation — pass 2 (AS-082 re-verification)

Mission: 20260920-124226 · Date: 2026-09-20 · Driver: Playwright (Chromium) via a standalone Node script.
App booted with `npm run dev` → http://localhost:3000 (per `tech-decisions.md` → "How to run the app"); stopped at exit.
**No project code was modified.**

**Result: GREEN** — AS-082 now PASSES. AS-070, AS-071 and AS-083 re-confirmed PASS. No new regressions.

## Fixture

Seeded with the Supabase admin client using the magic-link → session-cookie technique from
`tests/e2e/m6-people-switcher-mobile.spec.ts`. Signed in as **Alice Anderson** (owner); active
members **Bob Brown** and **Carol Clark**. Five blocks in the current ISO week, deliberately sharing
colours *across* people so any per-person tint would show as a mismatch. Workspace, members, blocks
and auth users deleted at the end of the run.

Evidence dir: `/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/M8-pass2/`
Machine-readable results: `.../evidence/M8-pass2/P2-results.json` · Trace: `.../evidence/M8-pass2/P2-trace.txt`

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|----|---------|----------|----------------------------|
| **AS-082** (stacked layout usable at mobile width) | **PASS** | `P2-01-as082-mobile-375.png`, `P2-02-as082-mobile-375-full.png`, `P2-03-as082-header.png`, `P2-04-as082-after-next.png`, `P2-05-as082-after-today.png`, `P2-06-as082-switcher-open.png`, `P2-results.json` → `as082` | See detail below. |
| **AS-070** (header states whose planner) | **PASS** | `P2-07-as070-single-other.png`, `P2-08-as070-multi.png`, `P2-results.json` → `as070` | `/calendar` (own planner, no params) → subtitle element count **0** (correct). `?people=<bob>` → **"Bob Brown's schedule"**. `?people=<bob>,<carol>` → **"Bob Brown, Carol Clark"**. `?people=<alice>,<bob>,<carol>` → **"Bob Brown, Carol Clark"** (viewer's own name correctly omitted). |
| **AS-071** (no per-person colour tint) | **PASS** | `P2-09-as071-colours.png`, `P2-results.json` → `as071` | Computed styles read off every rendered `stacked-block-*` in the 3-row stacked layout. Alice Green and **Bob** Green are byte-identical: `border rgb(34, 197, 94)` / `bg rgba(34, 197, 94, 0.1)`. Alice Pink and **Carol** Pink are byte-identical: `rgb(236, 72, 153)` / `rgba(236, 72, 153, 0.1)`. All blocks `opacity: 1`, `filter: none`. The same colour renders identically regardless of which person's row it sits in — no per-person modulation. |
| **AS-083** (rows exposed as labelled regions) | **PASS** | `P2-a11y-tree.txt`, `P2-10-as083-aria.png`, `P2-results.json` → `as083` | Playwright `ariaSnapshot()` of `[data-testid="stacked-planner"]` (real accessibility tree). Role lookup `getByRole("region", { name: "<name>'s schedule" })` resolves to exactly **1** node for each of Alice Anderson, Bob Brown and Carol Clark. |

## AS-082 detail — the pass-1 failure is resolved

Viewport **375 × 812**, URL `/w/<slug>/calendar?people=<alice>,<bob>,<carol>` (stacked layout, 3 rows).

**Nav controls — all three inside the viewport, hit-testable, and clickable:**

| Control | Rect (x, y, w, h) | right edge | in viewport | `elementFromPoint` hits itself |
|---------|-------------------|-----------|-------------|-------------------------------|
| Previous week | 277, 200, 40, 34 | 317 | yes | yes |
| Today | 171, 238, 64, 34 | 235 | yes | yes |
| Next week | 239, 238, 40, 34 | 279 | yes | yes |

Every control's right edge is ≤ 375. In pass 1 these were at x 355–395 / 399–463 / 467–507 — entirely
off-screen. The differing `y` values (200 vs 238) show the `flex-wrap` from F046 doing its job: the
group now breaks onto a second line instead of spilling past the clip edge. The switcher's parent
reports `flexWrap: "wrap"` in computed style, confirming the fix is the active cause.

**No horizontal scroll, no clipping:**
- `document.documentElement.scrollWidth 375 == clientWidth 375`
- `window.scrollX` remains `0` after `window.scrollTo(9999, 0)`
- `<main>`: `scrollWidth 219 == clientWidth 219` — the inner overflow that pass 1 found (`scrollWidth
  360 vs clientWidth 219`, clipped by `overflow-x: hidden`) is **gone**.

**Real interaction, driven by raw `mouse.click()` at viewport coordinates** — no Playwright
auto-scroll, no `scrollIntoView`, so this is a gesture a real user can make:
- Start `Sep 14 – Sep 20, 2026` → click **Next week** → `Sep 21 – Sep 27, 2026`
- → click **Previous week** → `Sep 14 – Sep 20, 2026`
- → click **Today** → `Sep 14 – Sep 20, 2026`
- URL after Next: `?week=2026-09-21&people=<alice>,<bob>,<carol>` — the full `people=` list is preserved.

**People switcher reachable at 375px:** trigger visible at `x 171, w 74` (right edge 245, inside the
viewport); raw click opens `[data-slot="people-switcher-content"]`.

**Rows:** 3 `stacked-person-row-*` render at 375px with their `aria-label`s intact.

**Reproduction:** boot `npm run dev`, sign in, set viewport 375×812, go to
`/w/<slug>/calendar?people=<id1>,<id2>,<id3>`, and confirm the prev / Today / next controls are all
within x ∈ [0, 375] and respond to a direct click.

## Carried-over observations (unchanged, not assertion failures)

- **Shell rail does not collapse at mobile.** The workspace shell still occupies x 0–147, leaving
  `<main>` 219px of the 375px viewport. This is pre-existing and app-wide
  (`app/(workspace)/w/[workspaceSlug]/layout.tsx` has no responsive classes) — not introduced by this
  mission. With the F046 wrap in place the Planner is usable inside those 219px, so it no longer
  blocks AS-082, but day columns remain narrow and block chips truncate.
- **`?people=me,<id>,<id>` drops the `me` entry** (recorded in pass 1). Unchanged; no shipped UI path
  emits it.
- **Fixture note, not a defect:** the seed script wrote block times in local wall-clock. Because
  `lib/calendar/stacked-window.ts` clips to **08:00–16:00 UTC** by documented contract, one seeded
  block (09:00–10:00 local = 07:00–08:00 UTC) fell entirely outside the window and did not render.
  That is the helper's stated behaviour, not a bug, and it does not affect any M8 assertion — the
  four rendered blocks still include both cross-person colour pairs AS-071 needs.

## Suggested fixes (not applied — validator does not modify code)

1. **Low priority, carried over.** Collapse or overlay the workspace shell rail below a mobile
   breakpoint so `<main>` gets the full 375px. Likely its own feature, app-wide in scope.
2. **Guard, carried over.** `tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` asserts only
   `documentElement.scrollWidth <= innerWidth`, which was blind to the pass-1 failure (overflow
   clipped inside `main`). A regression guard asserting each Planner header control's bounding rect
   is inside the viewport at 375px would lock the F046 fix in.

## Verdict

**GREEN.** AS-082 PASS — the three week-nav controls and the people switcher are all inside the
375px viewport, hit-testable, and drive real navigation via direct clicks. AS-070, AS-071 and AS-083
re-confirmed PASS with fresh evidence. No regressions observed.
