# Plan — Team Planner

_Mission: 20260920-124226_  _Written: 2026-09-20_

41 features across 9 milestones. Target per P-11: 15–45 min of worker time
each. Every feature names the assertions it covers.

**On M0.** The skill asks for a Foundation milestone — skeleton, dependency
install, green CI. Here the skeleton is an application that already exists
and this mission installs nothing (AS-084). M0 is therefore a **Baseline**
verification, the same substitution mission 20260919-150607 made: prove HEAD
is green before the first edit so it is later possible to tell what this
mission broke from what was already broken.

**Gate at every milestone:** `npx tsc --noEmit`, `npx eslint . --max-warnings=0`,
`npx vitest run tests/unit`, `npm run migrations:check`. This is AS-073…076
and it is a gate, not a feature.

---

## M0 — Baseline

| # | Feature | Assertions |
|---|---|---|
| F001 [CLARIFIED-AUTO] [COMPLETE] | Record HEAD state: tsc, eslint, vitest, migrations:check, migration count → run-log | — (gate evidence) |

## M1 — Pure logic, no UI ✅ GREEN (scrutiny pass 5)

Everything here is a pure function with unit tests. No component, no query,
no migration. This milestone exists so the hard rules (order preservation,
clipping, fallback) are settled and tested before anything renders them.

| # | Feature | Assertions |
|---|---|---|
| F002 [CLARIFIED-AUTO] [COMPLETE] | `parsePeopleParam` / `serializePeopleParam` — `me`/`all`/id-list, order-significant, dedupe-preserving-first-position | AS-003…006, AS-009, AS-010, AS-015 |
| F003 [CLARIFIED-AUTO] [COMPLETE] | Invalid-id handling in the parser: drop unknown, fall back to self when nothing survives | AS-007, AS-008 |
| F004 [CLARIFIED-AUTO] [COMPLETE] | `resolvePlannerLayout(selectionCount)` — one person → week grid, two or more → stacked | AS-016, AS-017 |
| F005 [CLARIFIED-AUTO] [COMPLETE] | Stacked window constants (08:00–16:00, Mon–Fri) + `clipBlockToStackedWindow` | AS-018…AS-022 |
| F006 [CLARIFIED-AUTO] [COMPLETE] | `orderPeopleForWholeTeam` — self first, then alphabetical by name | AS-058 |
| F007 [CLARIFIED-AUTO] [COMPLETE] | Unit tests for F002–F006, including the "order is not sorted" regression | AS-072 |

## M2 — Database

Two migrations. Both contradict description.md's "nema izmene baze"; both
were chosen deliberately in discovery round 2 (2.1b, 2.5c) and the
contradiction is recorded there.

| # | Feature | Assertions |
|---|---|---|
| F008 [CLARIFIED-AUTO] [COMPLETE] | Migration: replace `calendar_blocks_select_visible` with a workspace-member-only predicate, dropping the `is_project_visible_to` branch | AS-025, AS-026, AS-027, AS-028 |
| F009 [CLARIFIED-AUTO] [COMPLETE] | Migration: drop `calendar_blocks.task_id` and `calendar_blocks_task_id_idx` | AS-038, AS-039, AS-041 |
| F010 [CLARIFIED-AUTO] [COMPLETE] | Apply migrations, regenerate DB types, prove no drift | AS-076 |
| F011 [CLARIFIED-AUTO] [COMPLETE] | RLS tests: cross-member read allowed, cross-member write still refused, non-member read refused | AS-028, AS-032 |

## M3 — Data layer

| # | Feature | Assertions |
|---|---|---|
| F012 [CLARIFIED-AUTO] | `getCalendarBlocks` takes an ordered `userIds` list and filters in the query, not after it | AS-005, AS-006, AS-029 |
| F013 [CLARIFIED-AUTO] | Blocks belonging to a deactivated member are excluded even when their id is passed | AS-031 |
| F014 [CLARIFIED-AUTO] | Switcher member source: active members only, with avatar and name | AS-030 |

## M4 — Tasks leave the Planner

Removal milestone. `getCalendarTasks` is used by this route and nothing else,
and the whole filter bar exists only to narrow tasks, so both go.

| # | Feature | Assertions |
|---|---|---|
| F015 [CLARIFIED-AUTO] | Remove the all-day task strips from the week grid | AS-033 |
| F016 [CLARIFIED-AUTO] | Remove the task fetch from the page; ignore stale task-filter params without erroring | AS-034, AS-036 |
| F017 [CLARIFIED-AUTO] | Delete `CalendarFilters` and `resolveCalendarFilters` from the Planner route | AS-035 |
| F018 [CLARIFIED-AUTO] | Remove the task link from the block form, its Server Action, and its Zod schema | AS-037 |
| F019 [CLARIFIED-AUTO] | Delete the obsolete task-in-Planner tests; prove My Tasks is untouched; prove no dead task code remains on the route | AS-040, AS-080, AS-081 |

## M5 — Other members' blocks are read-only

Fixes a live defect: today the grid offers drag and resize on blocks the
server will refuse to let the caller write.

| # | Feature | Assertions |
|---|---|---|
| F020 [CLARIFIED-AUTO] | Thread the signed-in member's id into the grid; single ownership predicate used by every affordance below | AS-046 |
| F021 [CLARIFIED-AUTO] | No resize handles on another member's block | AS-042 |
| F022 [CLARIFIED-AUTO] | No drag-to-move on another member's block | AS-043 |
| F023 [CLARIFIED-AUTO] | Read-only detail popover for another member's block — no save, no delete | AS-044, AS-045 |
| F024 [CLARIFIED-AUTO] | No create affordance and no drag-to-create on another member's column or row; own grid unaffected | AS-047, AS-048, AS-049 |
| F025 [CLARIFIED-AUTO] | Test that a direct write to another member's block is refused server-side | AS-050 |

## M6 — The people switcher

| # | Feature | Assertions |
|---|---|---|
| F026 [CLARIFIED-AUTO] | `PeopleSwitcher` shell: combobox listing active members with avatar and name, type-to-filter | AS-052, AS-053 |
| F027 [CLARIFIED-AUTO] | Multi-select behaviour + avatar-group trigger with overflow count | AS-054, AS-055 |
| F028 [CLARIFIED-AUTO] | "Just me" and "whole team" shortcuts, the latter using F006's ordering | AS-056, AS-057 |
| F029 [CLARIFIED-AUTO] | Wire the switcher to the URL: write `?people=`, preserve `?week=`, empty selection falls back to self, nothing stored in the browser | AS-011, AS-012, AS-013, AS-059 |
| F030 [CLARIFIED-AUTO] | Header placement alongside the week controls; reachable at mobile width; keyboard-operable | AS-051, AS-060, AS-061 |

## M7 — The stacked layout ✅ GREEN (scrutiny pass 10 + UX pass)

| # | Feature | Assertions |
|---|---|---|
| F031 [CLARIFIED-AUTO] | Page-level layout derivation and multi-person fetch; default with no params is self + week grid | AS-001, AS-002, AS-014, AS-023 |
| F032 [CLARIFIED-AUTO] | `StackedPlanner` shell: one labelled row per selected person, in `?people=` order, empty people included | AS-024, AS-062, AS-063 |
| F033 [CLARIFIED-AUTO] | Row body: five day columns, 08:00–16:00, blocks clipped per F005 | AS-018…AS-022 |
| F034 [CLARIFIED-AUTO] | Time-off strip above each person's row | AS-066 |
| F035 [CLARIFIED-AUTO] | Drag a row to reorder; the new order is written back into `?people=` | AS-064, AS-065 |
| F036 [CLARIFIED-AUTO] | Scroll behaviour for many rows; block keeps its own colour; no summary rendered | AS-067, AS-068, AS-069 |

## M8 — Polish and QA ✅ GREEN (scrutiny pass 3 + UX pass 2)

| # | Feature | Assertions |
|---|---|---|
| F037 [CLARIFIED-AUTO] | Header states whose planner is shown when it is not the viewer's own; confirm no per-person tint anywhere | AS-070, AS-071 |
| F038 [CLARIFIED-AUTO] | Accessibility: stacked rows as a labelled region, announced per person | AS-083 |
| F039 [CLARIFIED-AUTO] | Mobile pass for the stacked layout | AS-082 |
| F040 [CLARIFIED-AUTO] | End-to-end specs: default is own planner; two people gives stacked; another's block will not drag | AS-077, AS-078, AS-079 |
| F041 [CLARIFIED-AUTO] | Final gate: tsc, eslint, vitest, migrations:check, and a diff proving `package.json` gained no dependency | AS-073, AS-074, AS-075, AS-076, AS-084 |

## M1 follow-up (scrutiny pass 3 — spawned 2026-09-20)

| # | Feature | Assertions |
|---|---|---|
| F042 [CLARIFIED-AUTO] [COMPLETE] | Fix `clipBlockToStackedWindow` to return per-day array (multi-day blocker) | AS-021, AS-022 |
| F043 [CLARIFIED-AUTO] [COMPLETE] | Harden `parsePeopleParam` input normalisation | AS-004 |
| F044 [CLARIFIED-AUTO] [COMPLETE] | Delete vacuous AS-015 test; re-home to F031 | AS-015 |
| F045 [CLARIFIED-AUTO] [COMPLETE] | Fix AS-058 locale fixture and comparator | AS-058 |
| F046 [CLARIFIED-AUTO] [COMPLETE] | Pin UTC contract: add `toUtcMs` normaliser | AS-022 |
| F047 [CLARIFIED-AUTO] [COMPLETE] | Purge `task_id` from app code (M2 blocker) | AS-025, AS-038 |
| F048 [CLARIFIED-AUTO] [COMPLETE] | Fix migration timestamp ordering (20260920 → 20261128) | AS-076 |
| F049 [CLARIFIED-AUTO] [COMPLETE] | Fix `toUtcMs` for ±HH:MM offset formats (F046 regression, M1 pass-3 blocker) | AS-022 |
| F050 [CLARIFIED-AUTO] [COMPLETE] | Make AS-058 sort falsifiable — fixture inversion + tie-break | AS-058 |
| F051 [CLARIFIED-AUTO] [COMPLETE] | Add AS-026 test (block on private project still readable); graceful network skip | AS-026 |
| F052 [CLARIFIED-AUTO] [COMPLETE] | Fix AS-003/AS-008 fixtures — selfId must differ from activeMemberIds[0] | AS-003, AS-008 |
| F053 [CLARIFIED-AUTO] [COMPLETE] | Fix AS-026: use visibility:private project + narrow try/catch in RLS suite | AS-026 |
| F054 [CLARIFIED-AUTO] [COMPLETE] | Seed AS-026 fixture via adminClient | AS-026 |

---

## Two findings the answers produced that are worth stating plainly

**The per-person colour work disappeared.** Round 1 answer 24 asked for
colour-by-person, and round 2 (2.10) settled it as "block colour wins, person
shown by avatar plus a thin band". But answer 15 sends any multi-person
selection to the stacked layout, where 2.11 says a person needs no colour
because the row is already theirs. So no layout ever shows two people's blocks
in one grid, and the whole colour-by-person mechanism has nothing to do.
AS-071 nails that shut rather than leaving it as a half-built idea.

**`?view=` is gone and the mode is derived.** The description named
`?view=stacked`. With the layout derived from how many people are selected
(2.8a), a second parameter could only ever contradict the first. AS-015 makes
the absence testable.
