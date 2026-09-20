# M6 — The people switcher — scrutiny pass 8

Date: 2026-09-20
Scope: F026–F030 (+ follow-ups F067–F086)
Verdict: **RED** — 1 FAIL (major), 8 PASS, 4 INCONCLUSIVE (deferred)

Method: three independent reviewers, each given only assertion text + a file
list (no handoffs, no prior scrutiny reports), each required to run real
mutation tests (apply → run → `git checkout --`). All unit runs used
`--no-cache`; this repo has repeatedly produced false green/survived readings
from stale Vite transform caches. Tree verified clean before and after all
mutation work.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-011 | INCONCLUSIVE | DEFERRED after 5 loop-guard attempts (F067/F071/F075/F079/F080). Not re-raised. The page call site remains guarded only by a source-text regex; `peopleParam: peopleParam ? undefined : peopleParam` still survives. Carry to M7. |
| AS-012 | PASS | Unchanged from pass 7. Deleting `if (weekParam) params.set("week", …)` fails `f029-switcher-url-wiring.test.tsx`; asserted on the real pushed URL string. |
| AS-013 | PASS (major) | Unchanged. Both a `toggleMember` and a mount-effect `setItem` are caught. Fragility carried: the source scan is a hardcoded list of 5 paths while `components/calendar/` holds 11 files; any new Planner file opts out by existing. |
| AS-051 | PASS | Unchanged. Moving `PeopleSwitcherUrlBound` into a preceding sibling `<div>` fails the placement test; a negative test guards against a vacuous selector. |
| AS-052 | **FAIL (major)** | The pass-7 remediation (F085) is **partial and defeatable**. See below. |
| AS-053 | PASS | Unchanged. Prefix-only and case-sensitive filter mutations are both caught. |
| AS-054 | PASS (minor) | **Fixed.** All five mutations caught — see mutation log. Residual minor issues below. |
| AS-055 | INCONCLUSIVE | DEFERRED (no ResizeObserver / real layout in jsdom). Not re-raised. |
| AS-056 | INCONCLUSIVE | DEFERRED to M7/F031. Not re-raised. |
| AS-057 | PASS (major) | Unchanged. `members.slice(0, -1)` is caught, but the fixture has only 2 members, so "every active member" is a weak sample — a `slice(0,2)`-style cap would survive. User-visible half must be re-verified at M7. |
| AS-059 | INCONCLUSIVE | DEFERRED to M7/F031. Not re-raised. |
| AS-060 | PASS (major) | **Fixed.** All five mutations caught, including both required ArrowDown deletions. Residual coverage holes below. |
| AS-061 | PASS (major) | Playwright spec passes and is falsifiable, but **newly observed**: at Playwright's default 30s timeout a cold-start run FAILS (`Error: Channel closed` / `page.goto: Test ended` while Turbopack compiles the calendar route). It only passes on a warm server or with `--timeout=120000`. A milestone gate that runs this spec cold goes red for a non-code reason. Pass 7's local-skip concern and the missing evidence artifact are both still open — no `M6-evidence/` directory exists. |

## The three pass-7 remediations, judged

### AS-054 (F084) — genuinely falsifiable now

All five mutations caught, including the exact one that survived pass 7
(deleting **both** the `CheckIcon` and the `bg-accent` className). Accumulation
coverage is behavioural, not tautological: `test_AS_054_three_members_can_be_
selected_simultaneously` drives three real clicks through a stateful controlled
wrapper and asserts the growing array at each step, and the deselect test pins
that removal is surgical.

Residual (minor, not blocking):
- The check assertion is a **class-substring heuristic**, not a visibility
  check: `explicitCheckIcon` picks the first `<svg>` whose `class` lacks the
  literal `"opacity-0"`. jsdom computes no Tailwind, so this is string matching
  on an implementation detail.
- Mutation 1 is arguably a **conservative false positive**. `CommandItem` in
  `components/ui/command.tsx` always mounts its own
  `<CheckIcon className="ml-auto opacity-0 … group-data-[checked=true]/command-item:opacity-100" />`,
  and the row carries `data-checked` + `group/command-item` — so deleting the
  explicit CheckIcon still leaves a **visible** check in a real browser. The
  test fails anyway (the surviving icon's class contains `opacity-0`), i.e. it
  catches a change a user would not perceive. No false green, but the assertion
  is about *which element renders*, not *what is visible*.
- `isSelected && "bg-accent text-accent-foreground"` is still entirely
  untested — mutation 2 failed the same single test as mutation 1, so removing
  the row highlight alone would survive.

### AS-052 (F085) — FAIL, the guard is defeatable in both directions

The "avatar and name" clause is solid: rendering the real component with a
`window.Image` shim so Base UI's `AvatarImage` actually mounts, asserting the
real `<img src>` for a member with an avatarUrl and the `GH` fallback initials
for one without. Blanking the name (4 failures), deleting the `<Avatar>`
subtree (1), and dropping image+fallback while keeping the shell (1) are all
caught.

The "active workspace members" clause rests **entirely** on the F085 source
regex at `tests/unit/f029-switcher-url-wiring.test.tsx:341-376`. It reads
`page.tsx` as a string, `findIndex`es the first line matching
`/peopleSwitcherMembers[:=]\s*\{?\s*workspaceMembers\.\w+\.map/`, and asserts
that line says `.active`. Three findings:

1. **False negative (decisive).** Prepending a *commented-out* decoy
   `// peopleSwitcherMembers={workspaceMembers.active.map(...)}` above the real
   call site and making the live prop `.pending` leaves **16/16 green** with
   invited members leaking into the switcher. The guard matches the first line
   the regex hits and never checks that line is live JSX. A comment, a JSDoc
   example, or a dead branch defeats it.
2. **False positive.** Extracting `const switcherMembers = workspaceMembers.active.map(...)`
   and passing `peopleSwitcherMembers={switcherMembers}` — semantically
   identical, correct code — **fails** the test (`expected -1 to be greater
   than or equal to 0`). A guard that punishes correct refactors and passes
   broken code carries no signal.
3. **Second call site unguarded.** `page.tsx:108`
   `activeMemberIds: workspaceMembers.active.map((m) => m.userId)` feeds
   `parsePeopleParam`'s allowlist and has no guard at all. Leaking pending
   members there would let an invited user's id survive URL parsing; the
   `[...active, ...pending]` mutation at both sites produced exactly one
   failure, from the switcher line only.

F085 also skipped half its own spec: the feature file asked for a component
render test asserting exactly the active members appear, and the worker
explicitly declined it. So there is no behavioural test of this clause anywhere.

### AS-060 (F086) — falsifiable on all three verbs

Both required test mutations are caught: deleting `{ArrowDown}{ArrowDown}`
(highlight stays on Alice) and reducing to a single `{ArrowDown}` (lands on
Bob, not Carol). `tabIndex={-1}`, `readOnly`, and a no-op member `onSelect` are
all caught. Enter-to-toggle **is** asserted on the `onSelectionChange` payload
and mutation 5 proves that assertion is load-bearing, so the "toggled" verb is
genuinely covered.

Residual (major, not blocking):
- **The two halves never join.** The arrow test never presses Enter; the toggle
  test still filters to a single row where cmdk auto-highlights, so its
  `{ArrowDown}` remains a no-op. "Arrow to row N, then Enter, and the *Nth*
  member is toggled" is untested.
- The arrow test asserts only cmdk's own highlight state
  (`aria-selected` / `data-selected` / `aria-activedescendant`) — library
  behaviour, not app behaviour.
- **Escape-to-close is not covered** — no `{Escape}` in any people-switcher
  test file. **Keyboard de-selection is not covered** — deselection exists only
  via click.
- The "Roster" name-suffix filter is a defensible contrivance, but it hides the
  real list order: the `Shortcuts` group ("Just me" / "Whole team") sits above
  the members, so an unfiltered user's first ArrowDown lands on "Just me".
  Nothing tests arrowing through the real ordering into the member group.

## Cross-cutting a11y defect (independently confirmed by two reviewers)

`people-switcher.tsx:226` sets `aria-selected={isSelected}` on each member
`CommandItem`. This is **dead code**. In `node_modules/cmdk/dist/index.mjs` the
Item renders caller props first and its own value second:

```js
t.createElement(D.div,{ref:…, ...q, id:n,"cmdk-item":"",role:"option","aria-disabled":!!A,"aria-selected":!!R, …})
```

`R` is cmdk's keyboard-highlight state, so the DOM's `aria-selected` always
tracks *which row is highlighted*, never *which members are chosen*. A DOM
probe with `selectedUserIds: []` returned Alice as `aria-selected="true"` while
unselected. Consequence: multi-select state is exposed to assistive technology
**nowhere** — no `aria-checked`, no `role="checkbox"`, no
`aria-multiselectable`, and the `CheckIcon` is a decorative `<svg>` with no
accessible name. Separately, `command.tsx` already styles `data-selected:bg-accent`
for cmdk's hover/active row, so F081's selected-row `bg-accent` is visually
indistinguishable from mere hover.

## Mutation log (this pass)

| # | Mutation | Target | Result |
|---|---|---|---|
| 1 | delete `{isSelected ? <CheckIcon/> : null}` | people-switcher.tsx | **CAUGHT** — AS-054 selected-check test |
| 2 | delete CheckIcon **and** `isSelected && "bg-accent…"` | people-switcher.tsx | **CAUGHT** — same single test (pass 7: SURVIVED) |
| 3 | invert the check condition (`!isSelected`) | people-switcher.tsx | CAUGHT — 2 tests |
| 4 | `toggleMember` → `onSelectionChange([userId])` | people-switcher.tsx | CAUGHT — 2 tests |
| 5 | remove `data-checked={isSelected}` | people-switcher.tsx | CAUGHT — 3 tests |
| 6 | `peopleSwitcherMembers={workspaceMembers.pending.map(...)}` | page.tsx | CAUGHT — F085 regex |
| 7 | `[...active, ...pending].map(...)` at **both** call sites | page.tsx | CAUGHT — regex only; the `activeMemberIds` change was invisible |
| 8 | extract to `const switcherMembers = …active.map(...)` (semantically identical) | page.tsx | **FALSE FAILURE** — correct code fails |
| 9 | commented-out decoy `.active` line + real prop `.pending` | page.tsx | **SURVIVED — 16/16 green, invited members leak** |
| 10 | blank the member-name `<span>` | people-switcher.tsx | CAUGHT — 4 tests (+2 keyboard tests) |
| 11 | delete the `<Avatar>` subtree from the row | people-switcher.tsx | CAUGHT |
| 12 | keep `<Avatar size="sm"/>`, drop image + fallback | people-switcher.tsx | CAUGHT |
| 13 | delete `{ArrowDown}{ArrowDown}` | placement-a11y test | **CAUGHT** (pass 7: SURVIVED) |
| 14 | `{ArrowDown}{ArrowDown}` → `{ArrowDown}` | placement-a11y test | **CAUGHT** |
| 15 | `tabIndex={-1}` on `PopoverTrigger` | people-switcher.tsx | CAUGHT — all 3 AS-060 tests |
| 16 | `readOnly` on `CommandInput` | people-switcher.tsx | CAUGHT — search step |
| 17 | member-row `onSelect` → `() => {}` | people-switcher.tsx | CAUGHT — toggle payload never fires |

Tree verified clean after all mutation work:
`git status --porcelain -- app lib components tests` → empty.

## Recommended follow-up features

**Replace the AS-052 source regex with a data-flow test (major, blocking).**
The F085 guard is defeatable in both directions: a commented-out decoy line
carrying `.active` lets the live `peopleSwitcherMembers` prop be `.pending`
with the whole suite green, and a plain refactor to a named intermediate const
makes correct code fail. It also guards exactly one of the two call sites —
`page.tsx:108`'s `activeMemberIds`, which feeds `parsePeopleParam`'s allowlist,
is unguarded, so a pending member's id could survive URL parsing unnoticed.
Delete the regex block and replace it with real data flow: extract the page's
member mapping into a single exported pure helper in `lib/calendar/` that takes
a `getWorkspaceMembers` result and returns `{ switcherMembers, activeMemberIds }`,
then unit-test it with a roster containing one active and one pending member,
asserting the pending member appears in neither output. Additionally add the
component render test F085's own spec asked for and the worker skipped:
`PeopleSwitcher` given a mixed list shows exactly the active rows.

**Join AS-060's two keyboard halves and cover Escape and de-selection (major).**
Arrow navigation and Enter-to-toggle are each falsifiable, but in separate
tests that never meet — the toggle test still filters to a single auto-
highlighted row, so "arrow to a non-first row, press Enter, and *that* member
is toggled" is untested. Add one test on the 3-member fixture that presses
ArrowDown twice and then Enter, asserting `onSelectionChange` names Carol
specifically. Add a keyboard de-selection round trip (Enter on an already-
selected row yields a shrunken array), an `{Escape}` test asserting the popover
closes and focus returns to the trigger, and — since the real unfiltered list
puts the `Shortcuts` group above the members — one test arrowing through the
genuine ordering rather than the "Roster"-suffix contrivance.

**Give multi-select a real accessible signal and a perceptual test (major).**
`aria-selected={isSelected}` on the member rows is dead code: cmdk spreads
caller props before its own `aria-selected`, which it uses for keyboard
highlight, so the DOM attribute reports the highlighted row and an unselected
member can read `aria-selected="true"`. Selection state reaches assistive tech
through no channel at all. Move it to `aria-checked` with an appropriate role
(or render a real checkbox), add `aria-multiselectable` to the list, give the
CheckIcon an accessible name or `sr-only` "selected" text, and assert the
*rendered* attribute so any future library override is caught. In the same
feature, replace the `explicitCheckIcon` `opacity-0` class sniff with an
assertion on that accessible signal, add coverage for the `bg-accent` selected
row (currently untested), and pick a treatment distinguishable from
`command.tsx`'s existing `data-selected:bg-accent` hover style.

**Stabilise and evidence the AS-061 Playwright gate (major).**
The spec is genuinely falsifiable and passes, but a cold run at Playwright's
default 30s timeout fails with `Error: Channel closed` / `page.goto: Test
ended` while Turbopack compiles the calendar route on first hit — it only
passes warm or with `--timeout=120000`. Raise the spec's timeout (or add a
warm-up navigation in `beforeAll`) so a cold milestone gate is not red for a
non-code reason. Also still outstanding from passes 6 and 7: add an
`ALLOW_SKIP_E2E` opt-in so absent credentials are a hard failure by default
(the existing `process.env.CI` guard covers CI only, and a local run exits 0
reporting `1 skipped`), extend the assertion past trigger visibility to confirm
the popover content is not clipped outside the 375px viewport, and save the
passing run's trace and screenshot under
`missions/20260920-124226/milestones/M6-evidence/` — that directory still does
not exist.

**Broaden the AS-013 storage guard from a path list to a glob (major, carried).**
The source scan names five files by hand while `components/calendar/` contains
eleven; `add-block-popover.tsx`, `calendar-block-chip.tsx`,
`calendar-block-popover-form.tsx`, `time-off-day-strip.tsx`,
`time-off-delete-button.tsx` and `client-presentation-banner.tsx` are
unscanned, and any new Planner file opts out simply by existing. Replace the
list with a glob over `components/calendar/**`, `lib/calendar/**` and the
calendar route, and make the runtime guard stub both storages' full surface
(`setItem`, `removeItem`, `clear`) across a full interaction script.

**Strengthen the AS-057 "whole team" sample (major, carried).**
The fixture has 2 members, so "selects every active member" is proven against a
sample where a `slice(0, 2)` cap would survive. Re-run the assertion against a
5-member roster including a member whose name sorts before the signed-in user,
and assert the full ordered id list.

**Carry AS-011, AS-055, AS-056 and AS-059 into M7/F031 as mandatory assertions.**
All four are deferred, not met. `calendar/page.tsx:127` still passes the full
active roster to the block query and `week-view.tsx` never filters by
`selectedUserIds`, so "Just me" and "Whole team" render identical grids and the
user-visible half of AS-056/AS-059 cannot be observed. AS-011's page call site
is still regex-guarded after five attempts. AS-055's "when it does not fit"
clause is never evaluated — `maxVisibleAvatars` defaults to 3 and
`week-view.tsx` never passes it, so every non-default test exercises a
configuration that does not exist in production. F031's assertion set is
currently AS-001, AS-002, AS-014, AS-023; add AS-011, AS-055, AS-056 and
AS-059 so the M7 validator is forced to confirm them against the running app.

## Gate output

```
$ git status --porcelain -- app lib components tests
(empty — verified before and after all mutation work)

$ npx tsc --noEmit
exit 0 (no output)

$ npx eslint . --max-warnings=0
exit 0 (no output)

$ npx vitest run --no-cache \
    tests/unit/people-switcher.test.tsx \
    tests/unit/people-switcher-multiselect.test.tsx \
    tests/unit/people-switcher-placement-a11y.test.tsx \
    tests/unit/f029-switcher-url-wiring.test.tsx \
    tests/unit/f080-calendar-nav-hrefs.test.tsx \
    tests/unit/switcher-member-source.test.ts
 Test Files  6 passed (6)
      Tests  57 passed (57)
   Duration  2.70s

$ npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts
  1 failed
    [chromium] › m6-people-switcher-mobile.spec.ts:122:7 › AS-061: people switcher
    trigger is visible and operable at 375px mobile width
  Error: Channel closed
  Error: page.goto: Test ended.
    - navigating to "http://localhost:3100/w/f076-switcher-…/calendar", waiting until "load"
  (cold Turbopack compile exceeds the default 30s timeout)

$ npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts --timeout=120000
  ✓  1 [chromium] › … AS-061 … (2.9s)
  1 passed (5.8s)

$ npx vitest run tests/unit/     # full suite
 Test Files  41 failed | 468 passed | 1 skipped (510)
      Tests  133 failed | 3281 passed | 3 skipped (3417)
   Duration  86.68s
```

Note on the full suite: the 133 failures are unchanged from the pass-6/7
baseline and lie entirely outside M6 — `f003` page/section client-visibility
and the `f006`–`f104` / `f250` / `list-due-date-*` section-card and board
suites, a different mission's surface. No M6 file is among the 41 failing
files. Passing totals rose 3277 → 3281, matching the four tests F084–F086
added. A milestone gate that runs the full unit suite still cannot be green.
