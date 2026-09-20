# M8 Scrutiny Pass 1

**Result: FAIL**

All five M8 test files pass (15/15), `tsc --noEmit` exits 0, `eslint . --max-warnings=0`
exits 0, and `migrations:check` exits 0. But two assertions do not survive mutation
and one assertion is literally false against the repo.

## Checked assertions

| ID | Verdict | Severity | Reason |
|----|---------|----------|--------|
| AS-070 | PASS | — | Mutation `{subtitle ? (` → `{false ? (` in `components/calendar/planner-header.tsx` killed 2 of 5 tests. Own-planner / no-switcher negative cases are present, so it is not a "subtitle always renders" tautology. |
| AS-071 | PASS | minor | The F037 test itself is a weak source regex (`personPalette\|avatarColors\|personColors\[`) and is trivially bypassed by any other identifier. However, mutation — replacing `getCalendarBlockDisplayColor(segment.block.color)` with a per-user tint call in `stacked-person-row.tsx` — was killed by `tests/unit/f036-stacked-scroll-colour.test.tsx` (6 failures). Behaviour is genuinely guarded; the F037 half is decorative. |
| AS-082 | PASS | — | Mutation removing ` overflow-x-hidden` from `components/calendar/stacked-planner.tsx:159` killed the test. Test also guards against wide `min-w-[NNNpx]` reintroduction in both files. |
| AS-083 | PASS | — | Mutation removing `role="region"` from `components/calendar/stacked-person-row.tsx:138` killed both tests. The `getByRole("region", { name: /alice/i })` accessible-name matcher also catches a constant (non-personalised) `aria-label`. |
| AS-077 | **FAIL** | **blocker** | Survives mutation. I changed `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:132` from `parsePeopleParam(peopleParam, {...})` to `parsePeopleParam("all", {...})` — i.e. the Planner now opens on the **whole team** instead of the signed-in member — and `f040-e2e-assertions`, `f031-page-layout-derivation`, `f102-calendar-page-composition`, `f029-switcher-url-wiring` all still passed (50/50). The F040 test only calls `parsePeopleParam(undefined, ...)` directly; nothing asserts that the page actually forwards the URL param. The assertion says "the Planner opens on the signed-in member's own blocks" — that is untested. |
| AS-078 | FAIL | major | `resolvePlannerLayout(2) === "stacked"` is a one-line pure-function restatement of `selectionCount <= 1 ? "week-grid" : "stacked"` — the test mirrors the implementation. `f031` does add a source-text check that `<PlannerHeader>` sits above the layout conditional, but nothing proves selecting a second member *in the UI* produces the stacked layout. No end-to-end test exists, contrary to the assertion's wording. |
| AS-079 | **FAIL** | **blocker** | The test renders `CalendarBlockChip` and asserts `data-draggable="false"`. **`StackedPersonRow` does not render `CalendarBlockChip`.** Stacked blocks are plain `<div data-testid="stacked-block-...">` elements (`components/calendar/stacked-person-row.tsx:207-221`) with no dnd wiring and no `data-draggable` attribute at all. The test's own comment ("the actual chip StackedPersonRow's per-person grid would display a block through in the real app") is factually wrong. The ownership gate *is* real in the chip — mutating `const canMove = canDrag && isOwnBlock(...)` → `const canMove = canDrag` killed the test — but that guards the week grid, not the stacked layout AS-079 is about. If someone later made stacked blocks draggable for everyone, no test would notice. |
| AS-073 | PASS | minor | Verified by me: `npx tsc --noEmit` exit 0. No repo-checked test enforces it; `f041-final-gate.test.tsx` explicitly declines to (comment: "would triple the suite's wall-clock time"). Regression-prone. |
| AS-074 | PASS | minor | Verified by me: `npx eslint . --max-warnings=0` exit 0. Same caveat — no test enforces it. |
| AS-075 | **FAIL** | **blocker** | "The unit test suite passes." It does not. `npx vitest run tests/unit` → **41 failed files / 133 failed tests** out of 524 files / 3500 tests. All failures are in non-calendar areas (board, list, webflow, component-panel — see appended file list) and appear pre-existing rather than caused by M8, but the assertion as written is not satisfied, and no test enforces it. |
| AS-076 | PASS | — | `f041-final-gate.test.tsx` shells out to `npm run migrations:check` and asserts exit 0. Real gate, not a mirror. Passes. |
| AS-084 | PASS | minor | `git diff 1ab50a12~1 -- package.json` is empty, so no dep was added. But `MISSION_START_COMMIT = "1ab50a12~1"` is the F028 commit, which is *not* this mission's first commit — the earliest mission calendar commit is `3b92c53e feat(F004)`. I independently re-ran the diff from `3b92c53e~1`: also empty, so the assertion holds substantively. The second test (`suspiciousNames` regex on `/planner|stacked-calendar|people-switcher/i`) is vacuous — no real package would be named that. |

## Recommended follow-up features

**FU-1 (blocker, AS-077) — Prove the calendar page defaults to the signed-in
member's own planner.** Add a test that exercises the real wiring in
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, not the helper in
isolation. Either render the server component with a mocked Supabase layer and
assert the blocks query is scoped to `[user.id]` when no `?people=` param is
present, or — following the repo's existing source-scan convention in
`f031-page-layout-derivation.test.tsx` — assert structurally that the first
argument to `parsePeopleParam(...)` in page.tsx is the `peopleParam` binding
derived from `searchParams` and never a literal. The acceptance criterion is
the mutation above: replacing `peopleParam` with `"all"` must turn the suite
red.

**FU-2 (blocker, AS-079) — Test the drag gate where the stacked layout actually
lives.** `StackedPersonRow` renders its own inline block divs and has no drag
affordance and no `data-draggable` attribute. Either (a) make the stacked row
render through `CalendarBlockChip` so the existing `canDrag && isOwnBlock(...)`
gate genuinely applies, and retarget the AS-079 test at a rendered
`StackedPersonRow` containing another member's block; or (b) if stacked blocks
are intentionally static, assert that directly — render a `StackedPersonRow`
with a foreign block and assert the rendered element exposes no pointer-down
handler, no `draggable`, and no dnd-kit attributes, so a future change that
adds drag to stacked blocks fails the test. Also correct the misleading comment
in `tests/unit/f040-e2e-assertions.test.tsx`.

**FU-3 (major, AS-078) — Behavioural stacked-layout switch test.** Replace or
supplement the `resolvePlannerLayout(2) === "stacked"` restatement with a test
that goes through the selection path: given a `?people=` value naming two
active members, assert the page composes the stacked branch (source-structural
assertion that the `layout === "stacked"` branch renders `<StackedPlanner>` and
the `week-grid` branch does not, plus a render-level test that
`StackedPlanner` with two selected ids produces two `stacked-person-row-*`
regions).

**FU-4 (blocker, AS-075) — Reconcile "the unit test suite passes."** 133 tests
across 41 files fail. Triage them: confirm each failure predates this mission
(bisect against `3b92c53e~1`), then either fix them or record an explicit,
dated quarantine list in the mission folder naming every failing file and why
it is out of scope. AS-075 cannot be marked met while `npx vitest run
tests/unit` is red.

**FU-5 (minor, AS-073/074) — Make the process gates regression-proof.** Add a
CI-only or tagged vitest spec that shells out to `tsc --noEmit` and `eslint .
--max-warnings=0` (mirroring how `f041-final-gate.test.tsx` already shells out
to `migrations:check`), so the gates are enforced by the repo rather than by a
one-time worker run.

**FU-6 (minor, AS-071/084) — De-vacuate two guard tests.** The AS-071 source
regex only catches three hard-coded identifier spellings; broaden it to flag
any colour derived from `userId` inside the stacked components. The AS-084
`suspiciousNames` test matches package names that could never exist; replace it
with a snapshot of the exact `dependencies` + `devDependencies` key sets, and
fix `MISSION_START_COMMIT` to this mission's real first calendar commit
(`3b92c53e`).

## Verdict

**FAIL.** Three blockers: AS-077 survives a mutation that makes the Planner
open on the entire team; AS-079 is tested against a component the stacked
layout never renders; AS-075 is false — the unit suite has 133 failing tests.
AS-078 is major (implementation-mirroring test, and the assertion's "end-to-end"
requirement is unmet). AS-070, AS-082, AS-083, AS-076 are genuinely solid and
were confirmed by killing mutations. M8 should not be signed off until FU-1,
FU-2 and FU-4 land.

---

## Appendix: command output

### `npx vitest run` (M8 files only)
```
Test Files  5 passed (5)
     Tests  15 passed (15)
  Duration  8.22s
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
     Tests  133 failed | 3364 passed | 3 skipped (3500)
  Duration  88.80s
```

Failing files (all non-calendar):
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

### Mutation log

| # | Mutation | Target assertion | Result |
|---|----------|------------------|--------|
| M1 | `planner-header.tsx`: `{subtitle ? (` → `{false ? (` | AS-070 | KILLED (2 failed) |
| M2 | `stacked-person-row.tsx`: delete `role="region"` | AS-083 | KILLED (2 failed) |
| M3 | `stacked-planner.tsx:159`: delete ` overflow-x-hidden` | AS-082 | KILLED (1 failed) |
| M4 | `calendar/page.tsx:132`: `parsePeopleParam(peopleParam,` → `parsePeopleParam("all",` | AS-077 | **SURVIVED (50/50 pass)** |
| M5 | `calendar-block-chip.tsx:70`: `canDrag && isOwnBlock(...)` → `canDrag` | AS-079 (chip only) | KILLED (1 failed) |
| M6 | `stacked-person-row.tsx:203`: block colour → per-user tint | AS-071 | KILLED by f036 (6 failed) |

All mutations were reverted with `git checkout`; `git status --porcelain app components lib` is clean.
