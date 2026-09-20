# M8 UX Validation — Polish and QA

Mission: 20260920-124226 · Date: 2026-09-20 · Driver: Playwright (Chromium) via standalone Node scripts.
App: `npm run dev` → http://localhost:3000 (booted OK, stopped at exit). **No project code modified.**

**Result: FAIL** — AS-070, AS-071 and AS-083 pass cleanly; **AS-082 fails** (week-nav controls are
clipped off-screen and unreachable at 375px). All M7 spot-checks still hold — no regressions.

## Fixture

Seeded with the Supabase admin client (magic-link → session-cookie technique, as in
`tests/e2e/board-reorder.spec.ts` / `tests/e2e/m6-people-switcher-mobile.spec.ts`).
Signed in as **Alice Anderson** (owner). Active members: Bob Brown, Carol Clark.
Blocks in the current ISO week (`2026-09-14`), deliberately sharing colours **across** people so a
per-person tint would be visible: Alice `#22c55e` + `#ec4899`, Bob `#22c55e` + `#64748b`,
Carol `#ec4899`. Workspace and users deleted at the end of each run.

Evidence dir: `/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/M8/`
Machine-readable results: `.../evidence/M8/M8-results.json`, `.../evidence/M8/M8b-results.json`
Traces: `.../evidence/M8/M8-trace.txt`, `.../evidence/M8/M8b-trace.txt`

## Tested assertions

| ID | Verdict | Evidence | Reproduction / observation |
|----|---------|----------|----------------------------|
| **AS-070** (header states whose planner) | **PASS** | `M8-01-as070-single-other.png`, `M8-02-as070-multi-others.png`, `M8-03-as070-multi-with-self.png`, `M8-results.json` → `AS-070` | 1. `/w/<slug>/calendar` (no params, own planner) → `[data-testid="calendar-planner-subtitle"]` count **0** (correct: no subtitle when it's your own). 2. `?people=<bob>` → subtitle visible, text exactly **"Bob Brown's schedule"**. 3. `?people=<bob>,<carol>` (multi, viewer excluded) → **"Bob Brown, Carol Clark"**. 4. `?people=<alice>,<bob>,<carol>` (multi, viewer included) → **"Bob Brown, Carol Clark"** — the viewer's own name is correctly omitted from the list. In every non-self case the header names whose planner is on screen. |
| **AS-071** (no per-person colour tint) | **PASS** | `M8-05-as071-colours-stacked.png`, `M8-06-as071-colours-single.png`, `M8-results.json` → `AS-071` | Controlled fixture: Alice **and** Bob each own a `#22c55e` block; Alice **and** Carol each own a `#ec4899` block — so any per-person hue/tint/opacity shift would show as a mismatch between rows. Stacked layout (3 rows), computed styles read off every `stacked-block-*`: Alice Green `border rgb(34,197,94)` / `bg rgba(34,197,94,0.1)`; **Bob** Green **identical** `rgb(34,197,94)` / `rgba(34,197,94,0.1)`; Alice Pink and **Carol** Pink both `rgb(236,72,153)` / `rgba(236,72,153,0.1)`; Bob Slate `rgb(100,116,139)`. `opacity: 1` and `filter: none` on all five — no per-person modulation of any kind. Single-person layout (`?people=<bob>`) renders the same two swatches at the same exact values, so the colour is stable **across** layouts too. |
| **AS-083** (rows labelled for a screen reader) | **PASS** | `M8-a11y-tree.txt`, `M8-07-as083-aria.png`, `M8-results.json` → `AS-083` | Playwright `ariaSnapshot()` of `[data-testid="stacked-planner"]` (the real accessibility tree, not a DOM-attribute read): `- group "Team planner":` containing `- region "Alice Anderson's schedule"`, `- region "Bob Brown's schedule"`, `- region "Carol Clark's schedule"`. Cross-checked by role lookup: `getByRole("region", { name: "<name>'s schedule" })` resolves to exactly **1** node for all three members. Each region's accessible content carries that person's own blocks (e.g. Bob's region: `Bob Brown Mon Bob Green Tue Wed Bob Slate Thu Fri`). |
| **AS-082** (usable at mobile 375px, no horizontal overflow) | **FAIL** | `M8-08-as082-mobile-375.png`, `M8-09-as082-mobile-375-full.png`, `M8-11-mobile-header-clipped.png`, `M8b-results.json` → `navGeo` | See "AS-082 failure detail" below. Document-level overflow is clean (`documentElement.scrollWidth 375 == clientWidth 375`, `window.scrollX` stays `0` after `scrollTo(9999,0)`), but **inside** `<main>` the planner overflows and is clipped: `main` is `x=147 w=219 overflow-x:hidden scrollWidth 360 vs clientWidth 219`. The week-nav group is 336px wide in a 171px slot, putting **Previous week at x 355–395, Today at 399–463, Next week at 467–507** — all three entirely beyond the 375px viewport, with no scroll path to reach them. |

## AS-082 failure detail

**Assertion:** "The stacked layout remains usable at mobile viewport width."

**Observed at 375×812 on `/w/<slug>/calendar?people=<alice>,<bob>,<carol>`:**

- The workspace shell's left rail does not collapse at mobile — it occupies **x 0–147**, leaving
  `<main>` only **219px** of the 375px viewport.
- `components/calendar/planner-header.tsx` puts the switcher + "Add time off" + prev/today/next in a
  `flex items-center gap-1` group. That group does not wrap and measures **336px** inside a
  **171px** available width.
- `<main>` is `overflow-x-hidden`, so the spill is clipped rather than scrollable.
  Consequence: **all three week-nav controls are invisible and unreachable by a real user.**
  Confirmed as a hard reachability problem, not a measurement artefact — Playwright's trial click
  only succeeded after it *programmatically* scrolled the `overflow-x:hidden` container; a user has
  no gesture that does that, and `window.scrollX` cannot move off `0`.
- Rows themselves are otherwise fine: 3 rows render, each 147px wide × 368px tall with its
  `aria-label` intact, and `[data-testid="stacked-planner"]` scrolls **vertically**
  (`overflowY: auto`, `scrollHeight 1127` vs `clientHeight 612`, `scrollTop` reaches 515).
- Legibility is marginal at this width: day columns are **29px** wide and block chips **24px**, so
  chip text is truncated to a character or two (the `title` attribute still carries the full title,
  but that is a hover affordance, unavailable on touch).
- The single-person layout at 375px has the same document-level cleanliness
  (`scrollWidth 375 == clientWidth 375`) and the same clipped header.

**Note on scope:** the shell rail not collapsing is a pre-existing, app-wide condition —
`app/(workspace)/w/[workspaceSlug]/layout.tsx` contains no responsive classes at all, so this is not
something M8 introduced. What *is* in this mission's code is the non-wrapping header control group
(F088), which is what pushes the week-nav past the clip edge. The repo's existing mobile guard
(`tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts`) asserts only
`documentElement.scrollWidth <= innerWidth` and therefore passes here — it cannot see overflow
clipped inside `main`, which is exactly the failure mode present.

## M7 regression spot-checks — all still hold

| Check | Verdict | Observation (`M8-results.json` → `M7`, `M8-04-stacked-desktop.png`, `M8-04b-nav-today.png`) |
|-------|---------|-------------|
| Stacked layout renders for 2+ people | PASS | `?people=<carol>,<bob>,<alice>` → `stacked-planner` ×1, `calendar-week-view` ×0, 3 rows. |
| Rows in `?people=` order | PASS | Rendered id sequence byte-identical to the requested (non-alphabetical, self-last) sequence: `orderOK: true`; names `["Carol Clark","Bob Brown","Alice Anderson"]`. |
| People switcher visible in header (stacked) | PASS | `[data-slot="people-switcher-trigger"]` visible in the stacked layout at 1440px. |
| Week nav prev / next / today | PASS | Hrefs carry `week=2026-09-07` / `week=2026-09-21` / no-week, each preserving the full `people=` list. Clicking: `Sep 14 – Sep 20` → Next → `Sep 21 – Sep 27` → Previous → `Sep 14 – Sep 20` → Next ×2 → `Sep 28 – Oct 4` → **Today** → `Sep 14 – Sep 20`, URL drops `week=` and keeps `people=`. Layout stays stacked throughout (`stillStacked: 1`). |

## Incidental finding (not an M8 assertion, no assertion ID)

`?people=me,<bob>,<carol>` silently renders **two** rows, not three: `parsePeopleParam`
(`lib/calendar/people-selection.ts`) only honours `me` when it is the *entire* param value — inside a
comma list, `me` is not in `activeMemberIds` and is dropped by the AS-007 unknown-id rule. This is
consistent with the function's documented contract and the switcher only ever emits raw UUIDs in
multi-select, so no shipped UI path hits it; recording it only because a hand-written or shared URL
would lose the viewer's own row without any signal. Reproduced in `M8-trace.txt` (first run).

## Suggested fixes (not applied — validator does not modify code)

1. **AS-082, primary.** Let the header's control group wrap: the outer container is already
   `flex-wrap`, so the inner `flex items-center gap-1` in
   `components/calendar/planner-header.tsx` needs `flex-wrap` (and `min-w-0`) too, so
   prev/today/next drop onto a second line instead of past the clip edge.
2. **AS-082, contributing.** The workspace shell rail in
   `app/(workspace)/w/[workspaceSlug]/layout.tsx` should collapse (or overlay) below a mobile
   breakpoint; 219px of usable width is what makes every other mobile symptom (29px day columns,
   unreadable chips) severe. App-wide, likely its own feature rather than a Planner fix.
3. **Guard.** Extend the mobile regression check beyond
   `documentElement.scrollWidth` to assert that the planner's header controls are inside the
   viewport at 375px — the current guard is blind to overflow clipped inside `main`.

## Verdict

**FAIL.** AS-070, AS-071 and AS-083 are all evidenced PASS, and no M7 behaviour regressed. AS-082 is
a genuine failure: at 375px the stacked layout's rows survive but the week-navigation controls are
clipped out of the viewport with no user-reachable scroll path, so the layout is not usable at mobile
width as the assertion requires.
