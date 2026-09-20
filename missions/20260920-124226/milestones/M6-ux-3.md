# M6 UX validation — The people switcher (pass 3)

Mission: 20260920-124226 · Run: M6-ux-3 · Date: 2026-09-20
HEAD: `8b87ccdc` (clean tree for `components/calendar/`, `lib/calendar/`, `lib/queries/`)
App: `npm run dev` (Next.js 16.3.5, Turbopack) — booted OK, route compiles, HTTP 200, stopped at exit.
Driver: Playwright (Chromium) via standalone Node scripts. **No project code was modified.**

Evidence directory:
`/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/M6-pass3/`
Full trace: `.../M6-pass3/P3-trace.txt` (parts A–D).
Re-runnable harness, copied beside the evidence: `m6ux3.mjs` (AS-051…058),
`m6ux3b.mjs` (AS-059, 011, 012, 013, 060, 061), `m6ux3c.mjs` (AS-011 focused),
`m6ux3d.mjs` (AS-012 focused).

## Boot

The pass-2 blocker is gone. F095 moved `eachDateInRange` to `lib/calendar/date-utils.ts`
(`components/calendar/stacked-person-row.tsx:9` now imports from there) and added
`import "server-only"` at `lib/queries/time-off.ts:15`. `/` returns 200 and
`/w/<slug>/calendar` compiles and renders in both layouts.

## Test fixture

Seeded with the Supabase admin client (magic-link → cookie auth, the technique used by
`tests/e2e/board-reorder.spec.ts`).

- Workspace `m6ux3-1789930474621` (`4ec0f006-3c79-4b1d-b887-3c11b3bfda33`)
- Signed in as **Alice Anderson** `6ad705d3…` (owner, active)
- Active members: Bob Brown `d8228448…`, Carol Clark `a66772b8…`, Dave Davis `7288bad9…`, Erin Evans `15993c1c…`
- **Invited (not active)**: Pending Pat `c29221f4…` — negative case for AS-052
- `maxVisibleAvatars` left at the production default (3)

## Results — 14 / 14 PASS

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-011 | PASS | `P3-19-weeknav-STACKED.png`, `P3-19-weeknav-SINGLE.png`, `P3-12-week-nav-preserves-people.png`, `P3-trace.txt` part C | Load `?people=<self>,<bob>,<carol>`. Click Next → `week=2026-09-21`, label `Sep 21 – Sep 27, 2026`; Next → `2026-09-28`; Prev → `2026-09-21`; Today → `week` dropped, label back to `Sep 14 – Sep 20`. The full `people=` triple is byte-identical in the URL at every step, in both the stacked and the single-person layout. |
| AS-012 | PASS | `P3-13-people-change-preserves-week.png`, `P3-trace.txt` part D | From `?week=2026-09-21&people=<self>,<bob>,<carol>`, toggle `Dave Davis` on → `week=2026-09-21` unchanged, label still `Sep 21 – Sep 27, 2026`, `people` gains Dave. Repeat with the "Just me" shortcut → `?week=2026-09-21&people=me`, week still preserved. |
| AS-013 | PASS | `P3-trace.txt` part B | After exercising week nav, both shortcuts and several toggles: `localStorage` keys `[]`, `sessionStorage` keys `[]`. Nothing matching `/people|week|planner|calendar/i` in any key or value. All Planner state lives in the URL. |
| AS-051 | PASS | `P3-01-header-single.png`, `P3-07-hardload-1person.png`, `P3-07-hardload-2people.png`, `P3-07-hardload-5people.png` | Hard page loads at 1, 2 and 5 selected people. Every case: exactly 1 `[data-slot="people-switcher-trigger"]`, visible, in the same header row as "Previous week" / "Today" / "Next week" (counts 1/1/1). **F088 confirmed at runtime** — the switcher is now present in the stacked layout (2 and 5 people render `[data-testid="stacked-planner"]` *and* the header). Pass 1's one-way-trip defect is gone. |
| AS-052 | PASS | `P3-02-open.png`, `P3-05b-multi-popover.png` | Open the switcher. Rows: `Just me`, `Whole team`, then Alice / Bob / Carol / Dave / Erin, each with a circular initials avatar (5 `[data-slot="avatar"]` nodes). `Pending Pat` (status `invited`) is absent. |
| AS-053 | PASS | `P3-03-filter.png` | Type `Carol` → list narrows to `["Carol Clark"]`. Type `zzzz` → list empty, "No members found." visible. Clear → all five return. |
| AS-054 | PASS | `P3-04-selected-bob.png`, `P3-05-multi-3-selected.png`, `P3-05b-multi-popover.png`, `P3-06-deselected-bob.png` | +Bob → `?people=<self>,<bob>`; +Carol → `<self>,<bob>,<carol>`; −Bob → `<self>,<carol>` (Carol survives). Selected rows `data-checked="true"`; unselected `false`. **F089 confirmed at runtime**: each selected row shows exactly **1** visible tick (measured by computed opacity/visibility/box), unselected rows 0. The popover screenshot shows a single tick per selected row. |
| AS-055 | PASS | `P3-08-overflow-trigger-5.png`, `P3-08b-trigger-2.png` | Settled state after a hard load of `?people=<5 ids>`: the closed trigger has `[data-slot="people-switcher-avatar-group"]` with **3** avatars plus a **visible** `[data-slot="people-switcher-overflow-count"]` reading `+2`. With only 2 selected: 2 avatars, overflow badge not visible. Pass 1's "steady state unreachable" cause is removed by F088. (Cosmetic note below.) |
| AS-056 | PASS | `P3-10-just-me.png` | Invoked **from the stacked layout** with 5 selected: click "Just me" → `?people=me`, layout returns to the single-person week grid (`calendar-week-view` 1, `stacked-planner` 0). |
| AS-057 | PASS | `P3-09-whole-team.png` | From the stacked layout, click "Whole team" → `?people=` lists all five active members. Pending Pat's id never appears. |
| AS-058 | PASS | `P3-trace.txt` part A | Same click. Emitted sequence `6ad705d3(self), d8228448(Bob), a66772b8(Carol), 7288bad9(Dave), 15993c1c(Erin)` — byte-identical to the expected "self first, then alphabetical by name" sequence logged beside it. |
| AS-059 | PASS | `P3-11-empty-falls-back-self.png`, `P3-trace.txt` part B | Load `?people=<carol>` (Carol checked, Alice unchecked). Deselect Carol, leaving the selection empty → URL becomes `?people=me`. After a **hard reload**: Alice `data-checked="true"`, Carol `false`, `calendar-week-view` renders. The Planner falls back to the signed-in member, never an empty view. |
| AS-060 | PASS | `P3-14-keyboard-open.png`, `P3-15-keyboard-selected.png` | Keyboard only from `document.body`: 31 × `Tab` focuses the trigger; `Enter` opens the popover and moves focus to the `Find a person...` input; typing `Dave` narrows to `["Dave Davis"]`; `ArrowDown` sets `[cmdk-item][data-selected="true"]` on Dave Davis; `Enter` toggles him → `?people=<self>,<dave>`. |
| AS-061 | PASS | `P3-16-mobile-header.png`, `P3-17-mobile-open.png`, `P3-18-mobile-stacked-header.png` | Real Chromium at 375×812. Single-person layout: trigger visible, 42×38 px (icon-only below `sm`). Tap opens the popover with all rows. Tapping `Erin Evans` → `?people=<self>,<erin>` and the page settles into the stacked layout where the trigger is **still present and visible** (count 1). No horizontal document overflow at 375 px. |

## Regression status of the earlier fixes

- **F088** (PlannerHeader above both layout branches) — validated at runtime, AS-051 row.
- **F089** (double tick removed) — validated at runtime by visible-SVG counting, AS-054 row.
- **F095** (server-only leak) — validated by the route compiling and serving, see "Boot".

## Cosmetic observation (not an assertion failure, no follow-up required by the contract)

In the **closed** trigger the avatar group renders the initials without enough separation:
at 5 selected it reads as `AABBCC+2` with the initials visually colliding
(`P3-08-overflow-trigger-5.png`). The structure AS-055 asks for is all there — three avatars
and a `+2` overflow count — and the same avatars render correctly inside the popover list
(`P3-05b-multi-popover.png`), so this is a trigger-only spacing/ring issue, not a behavioural
defect. Flagged for the design-system pass rather than for M6.

## Suggested fixes

None for M6 behaviour. Optional, cosmetic: give the trigger's avatar group the same ring/offset
treatment the popover list avatars get, so overlapped initials stay readable.

## Notes for the orchestrator

- Two harness quirks were hit and worked around, neither is an app defect:
  1. Reopening the popover immediately after `Escape` can race; `m6ux3b.mjs` adds a
     close-then-open loop that also asserts the item list is populated.
  2. Week navigation takes longer than 600 ms to settle the URL; part A's 600 ms wait produced
     a false negative for AS-011/012 that disappeared at 2500 ms (parts C and D).
- Dev server stopped before exit.
- Throwaway fixtures left in place for reproducibility: `m6ux3-1789930474621` (this pass),
  plus `m6ux2-1789929202385`, `m6ux2-1789929280987`, `m6ev-1789929447655`,
  `m6ux-1789926140595` from earlier passes. Delete them with the admin client at milestone close.
