# M7 Scrutiny Pass 9

**Result: FAIL**

All verification was done by real mutation testing against the working tree
(each mutation applied, test run, file restored byte-identically — `git diff`
clean afterwards). No code, test, or contract was left modified.

## Checked assertions

- **AS-014: PASS** — `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:108`
  now reads `const weekKey = parseWeekKey(weekParam) ?? currentWeekKey("UTC");`.
  `timezone` is still threaded into `buildCalendarWeek(weekKey, timezone)` for
  display, which is correct — only the *default week choice* must be viewer-
  independent. Mutation applied: `currentWeekKey("UTC")` →
  `currentWeekKey(timezone)`. Result: 1 test failed
  (`test_AS_014_page_uses_server_time_not_viewer_timezone`). Non-tautological
  for this mutation class. Residual weakness (minor, not blocking): the guard
  is a source-text regex, so it proves the literal string is present rather
  than observing two viewers landing on the same week. A refactor that moved
  the call behind a helper would break the test without a behaviour change
  (false positive), not the reverse.
- **AS-063: PASS** — `tests/unit/f032-stacked-shell.test.tsx:76`. Fixture roster
  is now alphabetical (Alice, Bob, Carol) while `selectedUserIds` is
  `[carol-id, alice-id, bob-id]`, and the DOM-order assertion expects Carol
  first (`carolIndex >= 0; aliceIndex > carolIndex; bobIndex > aliceIndex`).
  Mutation applied: `{selectedUserIds.map(...)}` →
  `{[...selectedUserIds].sort().map(...)}` in
  `components/calendar/stacked-planner.tsx:163`. Result: 1 test failed. The
  fixture also discriminates roster-order iteration, since roster order and
  URL order now differ.
- **AS-064: PASS** — `tests/unit/f035-stacked-reorder.test.tsx`. The test drives
  the real dnd-kit `KeyboardSensor` (Space / ArrowDown / Space) against the
  rendered handle with no mocking of `@dnd-kit/*`. Mutation applied:
  `nextOrder.reverse();` appended after the splice-insert in `handleDragEnd`
  (`components/calendar/stacked-planner.tsx:143`). Result: 2 tests failed
  (`test_AS_064_drag_reorders_rows`, `test_AS_065_weekParam_preserved_on_reorder`).
  The `reverse()` mutation no longer survives. **Note (minor):** the specific
  DOM-order block F113 added is itself tautological — it feeds the captured
  `ids` array back in as `selectedUserIds` and then asserts the DOM equals
  `ids`, which holds for any component that renders in prop order. What
  actually kills `reverse()` is the pre-existing pair assertion
  `expect(aIndex).toBeLessThan(selfIndex)`. Assertion is nonetheless met.
- **AS-065: PASS** — week keys in `f035-stacked-reorder.test.tsx` are now
  Monday-anchored `YYYY-MM-DD` (`"2026-09-14"`, `"2026-09-21"`), which
  round-trip through `parseWeekKey`. `test_AS_065_weekParam_preserved_on_reorder`
  asserts `url` contains `week=2026-09-21` *and* that the reorder happened, and
  a third test asserts no `router.replace` without a gesture. The `reverse()`
  mutation above also failed this test, so it is not vacuous.
  Minor: `tests/unit/f036-stacked-scroll-colour.test.tsx:~195` still passes the
  stale invalid `weekParam: "2026-W38"` into a `PlannerHeader` render fixture.
  Harmless there (AS-069 test, week key unused for the assertion) but it is the
  same wrong-format value that caused the AS-065 defect and should be cleaned up.
- **AS-069: FAIL — blocker.** The claimed F114 fix does not exist. There is no
  F114 commit for AS-069 anywhere in the history; the latest AS-069 work is
  `ff494b59 fix(F109)`. The widened regexes in
  `test_AS_069_no_capacity_figure_in_any_planner_file` all still require a
  *keyword* adjacent to the figure (`total|booked|load|available|utili|spent|
  work|capacity|%\s*(booked|load|...)`), so a **bare** hours or percentage
  figure is uncaught — exactly the pass-8 blocker. Confirmed by mutation:
  inserting `<span>{blocks.length * 8}h</span>` next to the person's name in
  `components/calendar/stacked-person-row.tsx:140` renders a live per-person
  hours total in the Planner and **all 10 tests in
  `f036-stacked-scroll-colour.test.tsx` still pass**. The render-level guards
  are equally permissive: `/\d+\s*h\s*(total|booked|·)/i` does not match `8h`.
  The assertion text is absolute — "no hours total, no capacity figure, and no
  utilisation percentage anywhere" — so a test that only forbids labelled
  figures does not exercise it.
  Positive findings: `week-agenda.tsx` and `calendar-block-chip.tsx` **are** in
  the sweep list (both guarded by `existsSync`, so if either file is ever
  renamed the sweep silently skips it — major fragility), and
  `tests/unit/zz-dbg.test.tsx` **is** deleted.

## Carry-forward (not retried, per instruction)
- AS-001: DEFERRED
- AS-023: DEFERRED
- AS-066: DEFERRED

## Loop guard
- AS-064: resolved on attempt 5 (F035→F093→F101→F103→F113). Not deferred.
- AS-069: this is the next failed attempt in its own chain (F036→F105→F106→
  F109, now pass 9). One more attempt is available before the 5-attempt
  `[DEFERRED]` threshold.

## Other findings

**Suite is red (pre-existing, not an M7 regression).** `npx vitest run
tests/unit/` reports **133 failed / 3348 passed across 41 failed files**. None
of the 41 are calendar or planner files — they are Webflow/board/list suites
(`f003`…`f104`, `list-due-date-cell-*`) belonging to other missions. Cross-check:
the last 25 commits touched only `app/(workspace)/w/[workspaceSlug]/calendar/
page.tsx`, `components/calendar/*`, `lib/calendar/*`, `lib/queries/calendar-
blocks.ts`, `lib/queries/time-off.ts` and the matching tests. So M7 did not
cause these, but the stated GREEN precondition ("confirm all tests pass") is
not satisfiable at this commit, and the red baseline means an M7 regression
landing in one of those files would be invisible in CI.

- `npx tsc --noEmit`: clean, zero output.
- `npx eslint components/calendar lib/calendar app/(workspace)/w/[workspaceSlug]/calendar`: clean, zero output.
- All four M7 assertion test files pass at HEAD: 33 tests, 4 files.

## Severity summary

| Assertion | Result | Severity |
|---|---|---|
| AS-014 | PASS | — (minor: source-regex guard, not behavioural) |
| AS-063 | PASS | — |
| AS-064 | PASS | — (minor: F113's added DOM-order block is tautological; the older pair assertion is what catches the mutation) |
| AS-065 | PASS | — (minor: stale `"2026-W38"` fixture in f036) |
| AS-069 | **FAIL** | **blocker** |
| pre-existing suite failures | — | major (baseline red hides future regressions) |

## Recommended follow-up features

**Follow-up A — AS-069: forbid bare capacity figures in the Planner (blocker).**
The AS-069 guards currently only reject a numeric figure when a capacity
*keyword* sits next to it, so rendering a bare `8h` or `80%` beside a person's
name passes every test while plainly violating the assertion. Replace the
keyword-coupled patterns with an inverted, allowlist-based render check: render
the full `StackedPlanner`, `PlannerHeader`, `StackedPersonRow`, `WeekView`, and
`WeekAgenda` with realistic multi-block fixtures, extract `document.body.
textContent`, and assert that no substring matches `/\d+\s*h\b/i`, `/\d+\s*%/`,
`/\d+\s*hrs?\b/i`, or `/\d+\s*hours?\b/i` **except** the clock-time labels the
grid legitimately renders (e.g. axis hours like `09:00`), which should be
allowlisted by their specific rendered form or excluded by scoping the query to
the row/header subtrees rather than the whole body. The test must be proven
non-vacuous by temporarily inserting `<span>{blocks.length * 8}h</span>` into
`stacked-person-row.tsx` and confirming it fails. Also drop the `existsSync`
filter from the static sweep in `f036-stacked-scroll-colour.test.tsx` and
instead assert each listed path exists, so a rename cannot silently shrink
coverage.

**Follow-up B — AS-014: make the shared-week guard behavioural (minor).**
Replace the source-text regex in `test_AS_014_page_uses_server_time_not_viewer_
timezone` with a test that calls the actual week-derivation path twice with two
different viewer profile timezones (e.g. `Pacific/Kiritimati` and
`Pacific/Niue`, which straddle a date boundary) and no `?week=` param, and
asserts both produce the identical `weekKey`. That requires extracting the
two-line derivation from `page.tsx` into a small exported helper in
`lib/calendar/week-grid.ts` (e.g. `resolveDefaultWeekKey(weekParam)`) so it can
be imported directly. The resulting test survives refactors and fails for any
viewer-timezone leak, not just the one spelling the current regex knows about.

**Follow-up C — AS-064: replace the tautological DOM-order block (minor).**
In `tests/unit/f035-stacked-reorder.test.tsx`, the rerender-with-`ids` block
asserts the DOM matches the array it was just handed, which is true by
construction. Change it to assert the DOM order against the **expected literal**
`[PERSON_A, SELF_ID, PERSON_B]` after the drag, independent of what the URL
said, so the DOM check and the URL check are two independent witnesses of the
same reorder rather than one restated twice.

**Follow-up D — restore a green baseline outside M7 (major).**
41 test files across the Webflow, board, and list suites fail at HEAD, unrelated
to M7. Triage them into (a) genuinely broken behaviour and (b) tests stale
against intentional changes, then either fix or quarantine with explicit
`.skip` plus a tracking note. Until the baseline is green, no milestone can
honestly assert "the suite passes", and a real regression in those areas cannot
be distinguished from the existing noise.

---

## Verdict

**FAIL.** AS-069 is not met. The fix attributed to F114 was never committed, and
the live mutation `<span>{blocks.length * 8}h</span>` in
`components/calendar/stacked-person-row.tsx:140` renders a per-person hours
total in the Planner while all 10 AS-069 tests continue to pass. AS-014,
AS-063, AS-064 and AS-065 are all confirmed fixed by mutation. AS-064 is
resolved on its 5th attempt and does **not** need `[DEFERRED]`.

---

## Appendix: full tool output

### `npx tsc --noEmit`
```
(no output — clean)
```

### `npx eslint components/calendar lib/calendar "app/(workspace)/w/[workspaceSlug]/calendar"`
```
(no output — clean)
```

### `npx vitest run tests/unit/` (full suite)
```
 Test Files  41 failed | 477 passed | 1 skipped (519)
      Tests  133 failed | 3348 passed | 3 skipped (3484)
   Duration  87.03s
```

Failing files (all non-calendar, pre-existing):
```
tests/unit/f003-page-client-visibility-toggle.test.tsx
tests/unit/f003-section-client-visibility-toggle.test.tsx
tests/unit/f006-section-card-menu-kind-row.test.tsx
tests/unit/f007-cms-badge-section-card.test.tsx
tests/unit/f008-section-card.test.tsx
tests/unit/f009-board-layout.test.tsx
tests/unit/f011-slug-proposal.test.ts
tests/unit/f013-create-section.test.tsx
tests/unit/f014-rename-page.test.tsx
tests/unit/f015-rename-section.test.tsx
tests/unit/f016-change-page-kind.test.tsx
tests/unit/f017-delete-section.test.tsx
tests/unit/f018-delete-page.test.tsx
tests/unit/f020-reorder-sections.test.tsx
tests/unit/f022-reorder-columns.test.tsx
tests/unit/f023-keyboard-dnd.test.tsx
tests/unit/f024-drag-cancellation.test.tsx
tests/unit/f024-section-card-details-data.test.tsx
tests/unit/f025-section-card-node-meta-icon.test.tsx
tests/unit/f026-component-picker.test.tsx
tests/unit/f026-meta-bound-to-section.test.ts
tests/unit/f027-instance-display.test.tsx
tests/unit/f032-visual-distinction.test.tsx
tests/unit/f033-hover-highlighting.test.tsx
tests/unit/f034-component-panel.test.tsx
tests/unit/f035-component-detail.test.tsx
tests/unit/f036-rename-delete-panel.test.tsx
tests/unit/f044-page-column-slug-editor.test.tsx
tests/unit/f045-create-page-dialog-page-kind.test.tsx
tests/unit/f048-component-panel-dnd.test.tsx
tests/unit/f060-discipline-estimate-schema.test.tsx
tests/unit/f081-board-performance.test.tsx
tests/unit/f083-note-validation-ui.test.tsx
tests/unit/f084-keyboard-accessibility.test.tsx
tests/unit/f085-sortable-section-list-details-data.test.tsx
tests/unit/f096-invalidate-details-chain.test.tsx
tests/unit/f097-page-column-header-icon-state.test.tsx
tests/unit/f104-page-column-chain.test.tsx
tests/unit/f250-list-inline-edit.test.tsx
tests/unit/list-due-date-cell-empty-state.test.tsx
tests/unit/list-due-date-cell-optimistic.test.tsx
```

### M7 assertion test files at HEAD
```
npx vitest run tests/unit/f035-stacked-reorder.test.tsx \
  tests/unit/f032-stacked-shell.test.tsx \
  tests/unit/f102-calendar-page-composition.test.tsx \
  tests/unit/f036-stacked-scroll-colour.test.tsx

 Test Files  4 passed (4)
      Tests  33 passed (33)
```

### Mutation runs

1. AS-064/AS-065 — `nextOrder.reverse();` after splice-insert in `handleDragEnd`:
```
 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```
2. AS-014 — `currentWeekKey("UTC")` → `currentWeekKey(timezone)`:
```
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```
3. AS-063 — `selectedUserIds.map` → `[...selectedUserIds].sort().map`:
```
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```
4. AS-069 — `<span>{blocks.length * 8}h</span>` next to `{userLabel}` in `stacked-person-row.tsx`:
```
 Test Files  1 passed (1)
      Tests  10 passed (10)     <-- SURVIVED
```

All mutations reverted; `git diff` on `components/calendar/`,
`app/(workspace)/w/[workspaceSlug]/calendar/` and `lib/calendar/` is empty.
