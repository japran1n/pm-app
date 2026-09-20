# M7 UX Validation — The stacked layout

Mission: 20260920-124226 · Date: 2026-09-20 · Driver: Playwright (Chromium) via standalone Node scripts.
App: `npm run dev` → http://localhost:3000 (booted OK, stopped at exit). No project code modified.

**Result: GREEN**

## Fixture

Seeded with the Supabase admin client (magic-link → session-cookie technique, same as `tests/e2e/board-reorder.spec.ts`).

- Run A workspace `m7ux-1789937235650` (`ea55bd6e-…`), signed in as **Alice Anderson** (owner, active)
  - Active members: Bob Brown, Carol Clark, Dave Davis, Erin Evans
  - Blocks in the current ISO week: Alice/Mon 09–11, Bob/Tue 10–12, Carol/Wed 13–15. Erin has **no** blocks (empty-row case).
- Run B workspace `m7col-1789937317541` — colour-only fixture using in-palette swatches (see AS-067/AS-071).

Evidence dir: `/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/M7/`
Full trace: `.../evidence/M7/M7-trace.txt`

## Tested assertions

| ID | Verdict | Evidence | Reproduction / observation |
|----|---------|----------|----------------------------|
| AS-014 (stacked layout for 2+) | PASS | `M7-01-single.png`, `M7-02-stacked-order.png` | No params → `calendar-week-view` ×1, `stacked-planner` ×0. `?people=<carol>,<bob>,<alice>,<erin>` → `stacked-planner` ×1, `calendar-week-view` ×0. |
| AS-024 (person with no blocks still gets a row) | PASS | `M7-02-stacked-order.png`, trace | Erin Evans has zero blocks and still renders `stacked-person-row-5382fc29-…`. 4 selected → 4 rows. |
| AS-062 (each row labelled with its member's name) | PASS | `M7-02-stacked-order.png`, trace | Row first-lines are exactly `["Carol Clark","Bob Brown","Alice Anderson","Erin Evans"]`; each row's own `innerText` contains that member's name (4/4 checked per-id, not positionally). |
| AS-063 (rows in `?people=` order) | PASS | `M7-02-stacked-order.png`, trace | Requested order Carol, Bob, Alice, Erin — deliberately non-alphabetical and with the signed-in member third. Rendered `data-testid` id sequence is byte-identical to the requested id sequence (`order matches: true`). Not alphabetised, not self-first. |
| AS-051 (switcher in the header, both layouts) | PASS | `M7-01-single.png`, `M7-02-stacked-order.png`, `M7-03-stacked-trigger.png` | In the **stacked** layout: `[data-slot="people-switcher-trigger"]` count 1, visible true, alongside "Previous week" ×1, "Today" ×1, "Next week" ×1. Same in the single-person layout. The M6 blocking defect (header vanished in stacked layout) is **fixed** by the shared `components/calendar/planner-header.tsx`. |
| AS-055 (closed trigger = avatar group + overflow count) | PASS (cosmetic caveat) | `M7-03-stacked-trigger.png`, `M7-02-stacked-order.png`, trace | Now reachable in a settled state (the M6 INCONCLUSIVE is cleared). With 4 selected and the production default `maxVisibleAvatars=3`, the trigger renders `[data-slot="people-switcher-avatar-group"]` ×1 with a visible `[data-slot="people-switcher-overflow-count"]` reading `+1`. Caveat: the three initials overlap so tightly they read as `A ABBCC+1` at 1440px — legible as a group, not as individuals. Cosmetic only; the assertion's requirement is met. |
| Week nav prev/next/today (preserves `?people=`) | PASS | `M7-04-nextweek.png`, `M7-05-today.png`, trace | From the stacked layout: "Next week" → `?week=2026-09-21&people=<same 4 ids>`, label `Sep 14 – Sep 20, 2026` → `Sep 21 – Sep 27, 2026`, still stacked (`stacked-planner` ×1). "Previous week" → `?week=2026-09-14`, label back to `Sep 14 – Sep 20, 2026`. Two clicks forward then "Today" drops `week=` entirely, keeps `people=`, and restores the current-week label. The people selection survives every nav. |
| AS-064 (row can be dragged to a new position) | PASS | `M7-07-after-reorder.png`, trace | `?people=<alice>,<bob>,<carol>`. Pointer-drag `stacked-row-drag-handle-<alice>` down onto Carol's handle. Rows become `[bob, carol, alice]`. |
| AS-065 (reorder rewrites `?people=`, survives reload) | PASS | `M7-07-after-reorder.png`, `M7-08-after-reload.png`, trace | Same drag rewrites the URL to `?people=0235a77e…(bob),e1e96dda…(carol),bea0e28f…(alice)`. Hard-navigating to that URL re-renders the rows in exactly that order. |
| AS-067 (block keeps its own colour) | PASS | `M7-11-colours.png`, trace (re-run section) | Alice's two blocks render `#22c55e` (green) and `#ec4899` (pink); Bob's render `#22c55e` and `#64748b` (slate) — each block's stored swatch, exact rgb match on both border and 10% background. |
| AS-071 (no per-person colour tint anywhere) | PASS | `M7-11-colours.png`, trace | Deliberate control: Alice **and** Bob each own a `#22c55e` block. Both render identically (`rgb(34,197,94)` border, `rgba(34,197,94,0.1)` bg) in different swimlanes — no per-person hue, tint or opacity shift is applied. Distinct colours within one row are also preserved. |
| AS-068 (many members scroll, rows stay readable) | PASS | `M7-06-five-rows.png`, trace | 5 selected → 5 rows. `stacked-planner` has `overflow-y: auto`, `clientHeight 750` vs `scrollHeight 1886`, and every row keeps an identical **368 px** height. Rows scroll; they are not compressed. |
| AS-069 (no hours total / capacity / utilisation) | PASS | `M7-02-stacked-order.png`, trace | The entire `stacked-planner` text content is member names, `Mon…Fri`, and block titles. Regex sweep for `\d+\s*(h\|hrs\|hours)`, `capacity`, `utilis/utiliz`, `\d+\s*%` returns `null`. |
| Others' blocks read-only (no drag/resize affordances) | PASS | trace ("read-only affordances" section), `M7-09-other-person.png`, `M7-10-own-person.png` | Stacked layout: `calendar-week-resize-*` ×0, `calendar-week-add-slot-*` ×0; every `stacked-block-*` has `draggable=false`, no `role`, no `tabindex`, `cursor: auto`, and no dnd-kit draggable ancestor — **no** block in the stacked layout is interactive, including the viewer's own. Only the four `stacked-row-drag-handle-*` (row reorder, AS-064) are draggable. |
| Own blocks still show drag handles (control) | PASS | `M7-10-own-person.png`, `M7-09-other-person.png`, trace | Single-person layout: `?people=me` renders **2** `calendar-week-resize-*` handles on Alice's own block. `?people=<bob>` renders Bob's chip with **0** resize handles. Ownership gating works and is not a blanket disable. |

## Not tested (out of M7 / deferred)

- **AS-001, AS-023, AS-066** — DEFERRED per the run instruction. AS-066's time-off strip (`stacked-time-off-strip`) was not exercised; the schema gap blocks it.
- **AS-018…AS-022** (per-day clipping / 08:00–16:00 window) — the fixture's blocks all fall inside the window, so clipping was not exercised. Covered by F033's unit tests; no UI-level clipping evidence produced here.
- **AS-050** (server rejects a write aimed at another member's block) — not observable from the UI; belongs to scrutiny/RLS tests.

## Observations for follow-up (no M7 assertion fails)

1. **AS-070 will fail as currently built (M8 scope).** With `?people=<bob>` — a single person who is *not* the signed-in member — the header reads only `Sep 14 – Sep 20, 2026` plus a `BB` avatar in the switcher trigger. It does **not** state whose planner is being shown. AS-070 is assigned to F037 in M8, so this is a pre-existing gap, not an M7 regression. Reproduce: `/w/<slug>/calendar?people=<other-member-id>`; observe header text. Evidence: `M7-09-other-person.png`.
2. **Switcher avatar-group legibility (cosmetic).** At 1440px the three avatars in the closed trigger overlap enough that the initials smear into `A ABBCC+1`. Does not violate AS-055.

## Suggested fixes (not applied)

- For observation 1: `components/calendar/planner-header.tsx` is now the single header for both layouts and is the natural place for F037's "<Name>'s planner" title.
- For observation 2: increase the avatar-group negative-margin offset or add a ring separator in `components/calendar/people-switcher.tsx`'s trigger avatar group.

## Verdict

**GREEN.** All fourteen browser-observable M7 assertions pass with evidence. The stacked layout renders one labelled row per selected person in exact `?people=` order, the shared planner header keeps the people switcher and week nav present in both layouts (closing the M6 blocking defect and the AS-055 INCONCLUSIVE), row drag-reorder persists to the URL and survives reload, block colours are per-block with no per-person tint, many rows scroll at full height, no hours/capacity/utilisation figure appears anywhere, and no calendar block in the stacked layout is draggable or resizable while the viewer's own block in the single-person layout still exposes its resize handles.
