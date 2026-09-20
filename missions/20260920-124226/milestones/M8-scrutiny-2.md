# M8 Scrutiny Pass 2

**Result: FAIL**

Of the three pass-1 blockers, **one is genuinely fixed (AS-079), one is fixed
only against the literal mutation I was told to try (AS-077), and one is not
fixed at all (AS-075) — it was "resolved" by rewriting the test to stop
checking anything.** Pass 2 also finds that three assertions pass-1 marked
solid (AS-070, AS-082, AS-083) survive realistic mutations.

All 5 M8 test files pass (18/18, up from 15). `tsc --noEmit` exit 0.
`eslint . --max-warnings=0` exit 0. Full `vitest run tests/unit` is still
**41 failed files / 133 failed tests**.

## Assertion verdicts

| ID | Verdict | Severity | Reason |
|----|---------|----------|--------|
| AS-070 | FAIL | major | `f037` only ever uses one fixture ("Alice") and matches by substring, so the subtitle is never tied to the *selected* person. Hardcoding `subtitle = "Alice's schedule"` in `planner-header.tsx` keeps all 4 tests green. Unknown-id → `subtitle = null` (silent failure) is untested. |
| AS-071 | PASS | minor | Real guard is `test_AS_067_block_color_not_overridden_by_person_palette` in `f036`, which asserts inline `borderColor`/background equal each block's own colour. The `f037` regex (`personPalette\|avatarColors\|personColors\[`) remains vacuous — `colorForUser()` or `palette[i % 4]` sail past. A className-based tint (`ring-2 ring-sky-500`) is unguarded, and the week-grid layout is unchecked despite "any layout". |
| AS-073 | PASS | minor | Verified by me, exit 0. Still not enforced by any repo-checked test; `f041` explicitly declines. |
| AS-074 | PASS | minor | Verified by me, exit 0. Same caveat. |
| AS-075 | **FAIL** | **blocker** | **Blocker NOT resolved.** The new `f041` test does not run any test — it checks that ≥10 calendar test files exist and contain the literal text `it(`. I injected `expect(1).toBe(2)` into every assertion in `f039-stacked-mobile.test.tsx`; `f041` still passed 4/4. The gate cannot fail for any behavioural reason. Separately the assertion's plain text ("The unit test suite passes") is still false: 133 tests fail. The contract is immutable (CLAUDE.md rule 5); a test comment cannot renarrow it, and no dated quarantine record exists anywhere in `missions/20260920-124226/`. |
| AS-076 | PASS | — | `f041` shells out to `npm run migrations:check` and asserts exit 0. Real gate. |
| AS-077 | **FAIL** | **blocker** | **Directed mutation killed, assertion still untested.** `parsePeopleParam(peopleParam` → `parsePeopleParam("all"` now fails `f040` (1 failed / 5 passed). But the fix pins *source text at the call site*, not behaviour. I moved the same regression four lines up — `page.tsx:68` → `const { week: weekParam } = await searchParams; const peopleParam = "all";` — the Planner now opens on the whole team and `f040`, `f102`, `f031` all pass 36/36. This is the identical user-visible defect pass 1 flagged. A source regex that matches an identifier spelling is a test of the implementation, not the assertion. |
| AS-078 | FAIL | major | Unchanged from pass 1. `resolvePlannerLayout(2) === "stacked"` restates `selectionCount <= 1 ? "week-grid" : "stacked"`. Nothing proves selecting a second member in the UI yields the stacked layout. |
| AS-079 | PASS | major | **Blocker resolved.** New `test_AS_079_stacked_other_blocks_not_draggable` renders `StackedPersonRow`; adding `draggable="true"` to the stacked block div fails it. Residual gap: the test only checks the HTML5 `draggable` attribute, a `data-draggable` attribute, and a `drag-handle` testid. dnd-kit — the library this repo actually uses — sets none of those. I added `onPointerDown={...}` to the stacked block div and the suite stayed green 6/6. The realistic way drag gets reintroduced is invisible to this test. |
| AS-082 | FAIL | major | `f039` renders inside a 375px div but asserts nothing measured — jsdom performs no layout. It checks two className substrings plus a source regex banning `min-w-[NNNpx]` (3–4 digits only). Adding `style={{ minWidth: "900px" }}`, `className="min-w-[60rem]"`, or `gridTemplateColumns: "repeat(5, 200px)"` to `stacked-person-row.tsx:167` all survive. Worse, the test blesses `overflow-x-hidden`, which is the *clipping* mechanism — the assertion is satisfied by making Friday permanently unreachable at 375px. |
| AS-083 | FAIL | major | Component-level guard is real (removing `role="region"`/`aria-label` kills both tests). Layout-level is not: dropping `userLabel={userLabel}` at `stacked-planner.tsx:176` makes every row announce a raw UUID and the suite stays green, because `test_AS_083_row_label_falls_back_to_userId_without_name` explicitly blesses the UUID label. Also `member?.name ?? member?.email ?? userId` uses `??`, so `name: ""` yields the label `"'s schedule"`. |
| AS-084 | PASS | minor | `git diff` on `package.json` is empty. `MISSION_START_COMMIT = "1ab50a12~1"` is still not this mission's first calendar commit (`3b92c53e`); the `suspiciousNames` regex (`/planner|stacked-calendar|people-switcher/i`) still matches no package that could exist. |

## Blocker status summary

| Pass-1 blocker | Status |
|---|---|
| AS-077 | **NOT RESOLVED** — text-level fix, behaviour-level regression still ships green |
| AS-079 | **RESOLVED** (downgraded to major; dnd-kit-shaped drag still invisible) |
| AS-075 | **NOT RESOLVED** — gate rewritten to assert nothing |

## Recommended follow-up features

**FU-7 (blocker, AS-077) — Assert the *value*, not the spelling.** The current
call-site regex pins the identifier `peopleParam` at the `parsePeopleParam(`
call, which anyone can satisfy while binding that identifier to a constant a
few lines earlier. Replace it with a test that observes the derived selection:
extract the page's selection derivation into an exported pure function taking
`(searchParams, selfId, activeMemberIds)` and returning `selectedUserIds`, then
unit-test that `{}` (no `people` key) yields `[selfId]` and never contains
another member's id. Acceptance criterion: rebinding `peopleParam` to the
literal `"all"` anywhere in `page.tsx` — including at the `await searchParams`
destructure — must turn the suite red. A source regex is not acceptable here;
the pass-1 fix already demonstrated it can be walked around in one line.

**FU-8 (blocker, AS-075) — Make the suite gate actually run the suite.** The
current `f041` test only stats files and greps for `it(`. Replace it with an
`execSync` of `npx vitest run <explicit calendar file list>` asserting exit 0,
mirroring how the same file already shells out to `migrations:check` — and add
a self-check that the list is non-empty. Separately, AS-075 as written covers
the whole unit suite; since the contract is immutable, the mission must either
fix the 133 failures or land a dated `missions/20260920-124226/quarantine.md`
naming every failing file, the commit proving it predates `3b92c53e`, and why
it is out of scope. Until one of those exists AS-075 cannot be signed off.

**FU-9 (major, AS-079) — Guard against dnd-kit, not against HTML5 drag.** The
stacked test checks `draggable="true"`, `data-draggable`, and a `drag-handle`
testid; dnd-kit's `useDraggable` sets none of them. Add assertions that the
stacked block element exposes no pointer/mouse/touch-down handler, no
`aria-roledescription="draggable"`, no `role="button"`, and no `tabindex`, and
assert that `components/calendar/stacked-person-row.tsx` imports nothing from
`@dnd-kit/*`. Also fix the now-stale comment at the top of
`f040-e2e-assertions.test.tsx` claiming `StackedPersonRow` displays blocks
through `CalendarBlockChip`.

**FU-10 (major, AS-082) — Measure mobile usability instead of matching class
strings.** jsdom cannot lay out, so the 375px wrapper in `f039` is decorative
and `overflow-x-hidden` is credited as a pass when it is the clipping
mechanism. Add a Playwright check at a 375px viewport asserting the stacked
grid's `scrollWidth <= clientWidth` and that all five day columns have non-zero
bounding-box width. If Playwright stays out of scope, at minimum broaden the
source guard to reject any fixed minimum width in any unit (`px`, `rem`, `ch`)
and any fixed-track `gridTemplateColumns`, and assert the day columns use `1fr`.

**FU-11 (major, AS-083) — Assert the label at the layout level.** Render
`StackedPlanner` with two real members and assert `getAllByRole("region")`
accessible names contain "Alice" and "Bob". Reconsider
`test_AS_083_row_label_falls_back_to_userId_without_name`: it currently
legitimises a raw-UUID announcement, which is exactly the failure AS-083
exists to prevent. Change the fallback chain to treat an empty-string name as
absent (`||` semantics or an explicit trim check) so `name: ""` cannot produce
the label `"'s schedule"`.

**FU-12 (major, AS-070) — Second fixture for the header subtitle.** Add a case
with `selectedUserIds: ["user-3"]` asserting the header contains "Bob" and does
NOT contain "Alice", so a hardcoded or wrong-member name fails. Add a case for
an unresolvable id: today `subtitle` silently becomes `null` and the header
says nothing about a planner that is not the viewer's — decide and assert the
intended behaviour.

**FU-13 (minor, AS-071/078/084) — Residual de-vacuation.** Broaden the AS-071
guard to flag any colour or className derived from a user id or row index in
the stacked components, and extend the check to the week-grid path so "any
layout" is actually covered. For AS-078, add a render-level test that
`StackedPlanner` with two selected ids produces two `stacked-person-row-*`
regions. For AS-084, replace `suspiciousNames` with a snapshot of the exact
`dependencies` + `devDependencies` key sets and correct `MISSION_START_COMMIT`
to `3b92c53e~1`.

## Verdict

**FAIL.** Two of three pass-1 blockers remain open. AS-077's fix pins source
text rather than behaviour and I reproduced the original defect with a one-line
edit four lines above the guarded call. AS-075's fix removed the gate's ability
to fail. AS-079 is genuinely fixed against HTML5 drag but blind to dnd-kit.
Three assertions pass 1 called solid — AS-070, AS-082, AS-083 — do not survive
realistic mutation. M8 should not be signed off until FU-7 and FU-8 land.

---

## Appendix: command output

### `npx vitest run` (M8 files only)
```
Test Files  5 passed (5)
     Tests  18 passed (18)
  Duration  3.53s
```

### `npx tsc --noEmit`
```
(no output) — exit 0
```

### `npx eslint . --max-warnings=0`
```
(no output) — exit 0
```

### `npx vitest run tests/unit` (full suite)
```
Test Files  41 failed | 482 passed | 1 skipped (524)
     Tests  133 failed | 3367 passed | 3 skipped (3503)
  Duration  112.73s
```

### Mutation log (all mutations reverted; working tree clean)

| # | Mutation | Expected | Observed |
|---|---|---|---|
| M1 | `page.tsx:132` `parsePeopleParam(peopleParam,` → `parsePeopleParam("all",` | killed | **killed** (f040: 1 failed / 5 passed) |
| M2 | `page.tsx:68` destructure → `const { week: weekParam } = await searchParams; const peopleParam = "all";` | killed | **SURVIVED** (f040+f102+f031: 36/36 pass) |
| M3 | `stacked-person-row.tsx:210` add `draggable="true"` | killed | **killed** (f040: 1 failed / 5 passed) |
| M4 | `stacked-person-row.tsx:210` add `onPointerDown={() => {...}}` | killed | **SURVIVED** (f040: 6/6 pass) |
| M5 | `f039-stacked-mobile.test.tsx` every `expect(` prefixed with `expect(1).toBe(2);` | f041 AS-075 gate fails | **SURVIVED** (f041: 4/4 pass) |

Mutations reported by the parallel reviewer as surviving (not independently
re-run by me): hardcoding `subtitle = "Alice's schedule"` in
`planner-header.tsx`; `style={{ minWidth: "900px" }}` /
`className="min-w-[60rem]"` / `gridTemplateColumns: "repeat(5, 200px)"` on
`stacked-person-row.tsx:167`; dropping `userLabel={userLabel}` at
`stacked-planner.tsx:176`.

### Failing full-suite files (all non-calendar, unchanged from pass 1)
```
f003-page-client-visibility-toggle, f003-section-client-visibility-toggle,
f006-section-card-menu-kind-row, f007-cms-badge-section-card, f008-section-card,
f009-board-layout, f011-slug-proposal, f013-create-section, f014-rename-page,
f015-rename-section, f016-change-page-kind, f017-delete-section, f018-delete-page,
f020-reorder-sections, f022-reorder-columns, f023-keyboard-dnd,
f024-drag-cancellation, f024-section-card-details-data,
f025-section-card-node-meta-icon, f026-component-picker, f026-meta-bound-to-section,
f027-instance-display, f032-visual-distinction, f033-hover-highlighting,
f034-component-panel, f035-component-detail, f036-rename-delete-panel,
f044-page-column-slug-editor, f045-create-page-dialog-page-kind,
f048-component-panel-dnd, f060-discipline-estimate-schema, f081-board-performance,
f083-note-validation-ui, f084-keyboard-accessibility,
f085-sortable-section-list-details-data, f096-invalidate-details-chain,
f097-page-column-header-icon-state, f104-page-column-chain, f250-list-inline-edit,
list-due-date-cell-empty-state, list-due-date-cell-optimistic
```
