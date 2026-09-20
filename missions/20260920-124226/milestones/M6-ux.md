# M6 UX validation — The people switcher

Mission: 20260920-124226 · Run: M6-ux-1 · Date: 2026-09-20
App: Next.js dev server, `npm run dev`, http://localhost:3000 (booted OK, stopped at exit)
Driver: Playwright (Chromium) via a standalone Node script; no project code modified.

## Test fixture

Seeded with the Supabase admin client (same magic-link → cookie auth technique as
`tests/e2e/board-reorder.spec.ts` and `tests/e2e/m6-people-switcher-mobile.spec.ts`).

- Workspace `m6ux-1789926140595` (id `b4e7e27b-1a68-4da3-a700-da00f42f6616`)
- Signed in as **Alice Anderson** (`3d913b37-f9ee-44f0-8b99-edbffc9bcdf5`, owner, active)
- Active members: Bob Brown `4c57eca0…`, Carol Clark `a8bb0510…`, Dave Davis `8799f52e…`, Erin Evans `bb47e369…`
- **Invited (not active)** member: Pending Pat `15e15bf8…` — the negative case for AS-052
  (the `workspace_members_status_check` constraint allows only `invited` | `active`, so
  "pending" is spelled `invited` in this schema)
- Route exercised: `/w/m6ux-1789926140595/calendar`
- `maxVisibleAvatars` is the production default (3) — `week-view.tsx` does not override it.

Evidence directory: `/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/`
Full step-by-step trace: `…/evidence/M6-trace.txt`

## Results

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-051 | PASS | `evidence/M6-01-header.png`, `evidence/M6-trace.txt` | Open `/w/<slug>/calendar`. The header row (`[data-testid="calendar-week-view"] > div:first-child`) contains exactly one `[data-slot="people-switcher-trigger"]` **and** the "Previous week", "Today" and "Next week" controls (counts 1/1/1). See the caveat under "Blocking defect" — this holds for the one-person (week-grid) layout, which is the only layout that renders a header today. |
| AS-052 | PASS | `evidence/M6-02-open.png`, `evidence/M6-trace.txt` | Open the switcher. Listed rows are exactly `Just me`, `Whole team`, `Alice Anderson`, `Bob Brown`, `Carol Clark`, `Dave Davis`, `Erin Evans` — each member with an avatar (initials fallback) and name. `Pending Pat`, the `invited`-status member, is **absent** (`'Pending Pat' present: false`). |
| AS-053 | PASS | `evidence/M6-03-filter.png`, `evidence/M6-trace.txt` | Type `Carol` into "Find a person..." → the list narrows to `["Carol Clark"]`. Type `zzzz` → list is `[]` and "No members found." is visible. Clearing restores all five. |
| AS-054 | PASS | `evidence/M6-04-selected-bob.png`, `evidence/M6-05-multi.png`, `evidence/M6-06-deselected-bob.png`, `evidence/M6-trace.txt` | Click `Bob Brown` → `?people=<self>,<bob>`; click `Carol Clark` → `?people=<self>,<bob>,<carol>`; click `Bob Brown` again → `?people=<self>,<carol>`. Several members are selected at once and toggling one never clears the rest. Selected rows carry `data-checked="true"`, a tick icon and `bg-accent`; unselected rows `data-checked="false"` with an `opacity-0` tick. Note: the URL is the authoritative observation here because the multi-person state immediately replaces the switcher (see "Blocking defect"). |
| AS-055 | **INCONCLUSIVE** (steady state unreachable) | `evidence/M6-08-overflow-trigger.png`, `evidence/M6-17…`/`M6-19-hardload-2people.png`, `evidence/M6-trace.txt` | With 5 selected and `maxVisibleAvatars=3` the closed trigger rendered `[data-slot="people-switcher-avatar-group"]` with 3 avatars plus a visible `[data-slot="people-switcher-overflow-count"]` reading `+2` — but this was only observable in the brief window before the RSC swap. A **full page load** of the same `?people=` URL renders the stacked-planner placeholder, which contains no switcher at all (0 trigger nodes), so a real user can never see the overflow badge in a settled state. The component is right; the route hides it. Re-run at M7 once `StackedPlanner` renders a header. |
| AS-056 | PASS | `evidence/M6-09-just-me.png`, `evidence/M6-trace.txt` | With several members selected, open the switcher and click "Just me" → URL becomes `?people=me` (the self-shorthand `serializePeopleParam` emits) and the Planner returns to the week-grid layout for the signed-in member alone. |
| AS-057 | PASS | `evidence/M6-07-whole-team.png`, `evidence/M6-trace.txt` | Click "Whole team" → `?people=<self>,<bob>,<carol>,<dave>,<erin>` — all five active members, and only active members (Pending Pat's id never appears). |
| AS-058 | PASS | `evidence/M6-trace.txt` | Same click as AS-057. Emitted order is `self, Bob, Carol, Dave, Erin` — signed-in member first, remaining four alphabetically by name — byte-identical to the expected id sequence logged alongside it. |
| AS-059 | PASS | `evidence/M6-21-carol-only.png`, `evidence/M6-22-empty-selection-fallback.png`, `evidence/M6-trace.txt` (addendum 4) | Load `?people=<carol>` (single non-self selection, so the switcher stays mounted). Open the switcher and click `Carol Clark` to deselect her, leaving the selection empty → URL becomes `?people=me`. After a **hard reload**, `Alice Anderson` is `data-checked="true"`, `Carol Clark` is `false`, and `calendar-week-view` still renders — the Planner falls back to the signed-in member rather than an empty view. |
| AS-060 | PASS | `evidence/M6-11-keyboard-open.png`, `evidence/M6-12-keyboard-selected.png`, `evidence/M6-trace.txt` | Keyboard only, no mouse: 31 × `Tab` from `document.body` lands focus on `[data-slot="people-switcher-trigger"]`; `Enter` opens the popover and focus moves to the `Find a person...` input; typing `Dave` narrows the list to `["Dave Davis"]`; `ArrowDown` highlights `Dave Davis` (`[cmdk-item][data-selected="true"]`); `Enter` toggles him on → `?people=<self>,<dave>`. |
| AS-061 | PASS | `evidence/M6-13-mobile-header.png`, `evidence/M6-14-mobile-open.png`, `evidence/M6-15-mobile-after-toggle.png`, `evidence/M6-trace.txt` | Real Chromium at 375×812. The trigger is visible with a 42×38 px box (icon-only, label dropped below `sm`), tapping it opens `[data-slot="people-switcher-content"]`, and tapping `Erin Evans` updates the URL to `?people=<self>,<erin>`. No horizontal document overflow at 375px. |

## Blocking defect found (affects AS-051 / AS-054 / AS-055 reachability)

**Selecting a second person removes the people switcher from the page, stranding the user.**

`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` derives
`layout = resolvePlannerLayout(selectedUserIds.length)`, and `resolvePlannerLayout`
returns `"stacked"` for any count `> 1`. In the `"stacked"` branch `WeekGridSection`
returns `<StackedPlanner …/>` — which today renders only the placeholder
"Stacked planner for N people (2026-09-14) -- coming soon." `WeekView`, and with it the
entire header row including `PeopleSwitcherUrlBound`, is not rendered at all.

Observed, reproducible across three consecutive runs:

| URL | switcher triggers in DOM | week-view nodes |
|-----|--------------------------|-----------------|
| `/calendar` (implicit self) | 1 | 1 |
| `/calendar?people=<self>,<bob>` | **0** | 0 |
| `/calendar?people=<self>,<bob>,<carol>,<dave>,<erin>` | **0** | 0 |

Evidence: `evidence/M6-18-hardload-1person.png`, `evidence/M6-19-hardload-2people.png`,
`evidence/M6-20-hardload-5people.png`, `evidence/M6-debug.png`,
`evidence/M6-trace.txt` (addendum 3).

User-visible consequence: from the Planner, picking a second teammate (or clicking
"Whole team") is a one-way trip. There is no control on the resulting screen to get back
to a smaller selection — only the browser Back button or hand-editing the URL. The
"Just me" and "Whole team" shortcuts are therefore only reachable from the one-person
state.

This is expected-incomplete work rather than a regression (the stacked planner is M7),
but it is the reason AS-055 cannot be settled and it should be tracked so M7 does not
close without restoring the header.

## Cosmetic defect

**Selected member rows render two tick marks side by side.** The shared
`components/ui/command.tsx` `CommandItem` already emits its own check SVG
(`opacity-0 … group-data-[checked=true]/command-item:opacity-100`), and
`people-switcher.tsx` renders a second explicit `<CheckIcon className="ml-auto size-4" />`
when `isSelected`. Because the switcher also sets `data-checked={isSelected}`, both become
visible at once. Clearly visible in `evidence/M6-05-multi.png` — Alice, Bob and Carol each
show ✓✓. Unselected rows show one (invisible) tick, hence the `1` vs `2` SVG counts in the
trace.

## Suggested fixes (not applied — no code was modified)

1. Render the Planner header (week label, week nav, `PeopleSwitcherUrlBound`) for **both**
   layouts. Lifting the header out of `WeekView` into the page, above the
   `layout === "stacked"` branch in `WeekGridSection`, would make the switcher survive
   multi-select and would make AS-051/AS-055 testable in a settled state.
2. Drop the explicit `<CheckIcon>` from `people-switcher.tsx` and rely on `CommandItem`'s
   built-in `data-checked` tick (which the component is already feeding), or keep the
   explicit icon and stop setting `data-checked`. Either removes the doubled ✓.

## Cleanup

Test workspace `m6ux-1789926140595`, its six users and their `workspace_members` rows were
left in place so every row above is reproducible; delete them with the admin client when no
longer needed. The dev server was stopped before exit.
