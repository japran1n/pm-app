# M7 — Scrutiny pass 6

_Mission 20260920-124226 · 2026-09-20 · adversarial, read-only_

Method: three independent reviewers (no handoff, no worker reasoning) were
given assertion text + file lists only, and were required to construct and
**execute** source mutations that break each assertion's intent while keeping
the tests green. A surviving mutation = the assertion FAILS, regardless of
whether the code is correct today. The validator independently re-verified the
headline AS-001 mutation. Working tree was confirmed clean before and after.

## Verdict: **FAIL — 4 blockers, 7 majors.** M7 is not done.

The recurring root cause across every failure is the same: M7's assertions are
guarded predominantly by **source-text regex sweeps** and by **unit tests of
pure helpers called in isolation**. Neither observes the composed page or the
rendered DOM, so the exact wiring defect each guard was written to prevent can
be reintroduced verbatim.

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-001 | **FAIL (blocker)** | `parsePeopleParam(peopleParam ?? "all", …)` — the *literal bug F104 claimed to fix* — reinstates whole-workspace disclosure with all 65 calendar tests green. Independently re-verified by the validator. |
| AS-002 | **FAIL (major)** | `resolvePlannerLayout(selectedUserIds.length + 1)` sends the no-param load to the 08:00–16:00 stacked view. The 24h/7-day halves are genuinely covered; the page-level branch choice is not. |
| AS-014 | **FAIL (major)** | Inserting `if (!selectedUserIds.includes(user.id)) selectedUserIds.unshift(user.id)` gives two equally-privileged viewers different people lists and different layouts. Nothing renders the page or compares two callers. |
| AS-018 | **FAIL (major)** | Hour-band geometry divided by 24 instead of 8 passes all 6 f033 tests — hour lines and blocks decouple. Also: **no visible hour labels exist at all**; "08:00–16:00" is only observable via `data-hour` test ids. |
| AS-019 | **FAIL (blocker)** | Rotating `DAY_LABELS` to `Sun,Mon,Tue,Wed,Thu` keeps f032+f033 green. Users read the wrong five weekday names. No test asserts rendered header text or `data-date`. |
| AS-020 | **FAIL (major)** | `segStart < segEnd` → `<=` in `lib/calendar/stacked-window.ts:112` survives all 22 window tests. Verified behaviourally: a 16:00–17:00 and a 06:00–08:00 Monday block each emit a zero-length segment and render as a real chip. The exact boundary cases are untested. |
| AS-021 | **FAIL (major)** | `getUTCDay()` → `getDay()` survives on this host and on UTC CI; only fails under `TZ=America/New_York`. No test pins `TZ`, and the `describe("under TZ=America/Los_Angeles")` block at `planner-stacked-window.test.ts:267` sets `process.env.TZ` in `beforeAll`, which **V8 ignores after init** — that block is a no-op giving false TZ confidence. |
| AS-022 | **PASS** | Genuinely strong: both-ends clipping, multi-day, Sun→Mon midnight, Fri→Sat, exact boundaries, and `Z`/`+00:00`/`+02:00`/`-05:00`/microsecond/space-separated parsing, plus pinned `top`/`height` percentages. No surviving mutation found. |
| AS-023 | **FAIL (major)** | Same `+ 1` mutation: narrowing to one person stays stacked. `test_AS_023_…` merely re-asserts `resolvePlannerLayout(1)`, which the mutation does not touch; the companion test is a positional source regex. |
| AS-024 | **FAIL (major)** | Suppressing the whole `stacked-grid` subtree when `blocks.length === 0` stays green — the "empty row is the signal" behaviour the code comment claims to protect is unguarded. f032 only asserts the name text appears. |
| AS-062 | **FAIL (minor)** | `style={{display:"none"}}` on the label div stays green; `getByText` does not check visibility. Label *sourcing* is well guarded. Identical member names are unprobed (`getByText` would throw, not assert per-row). |
| AS-063 | **FAIL (major)** | `flex-col` → `flex-col-reverse` reverses the order a user sees; the test reads `textContent.indexOf`, i.e. DOM order, never visual order. Sort-before-render *is* caught. |
| AS-064 | **PASS** | Real drag: unmocked `DndContext`/`SortableContext`, `getBoundingClientRect`/`ResizeObserver` stubs, Space→ArrowDown→Space on the real handle. Deleting `{...listeners}` fails it. Gap (minor): deleting the `PointerSensor` kills all mouse/touch drag and stays green. |
| AS-065 | **PASS** | `week` preservation and the reordered `people` are both asserted; `router.replace` pinned. Reload survival is structural — `StackedPlanner` holds no local order state, so the URL is the only source of truth. Minor: `handleDragEnd` builds a fresh `URLSearchParams`, silently dropping any other query param. |
| AS-066 | **DEFERRED** | No status column in schema. Out of scope for this pass. |
| AS-067 | **FAIL (blocker)** | Both colour tests render `StackedPersonRow` **directly**, one person only — nothing observes what `StackedPlanner` passes down. Verified: adding a `personColor?` prop consumed as `personColor ?? getCalendarBlockDisplayColor(...)` and having `StackedPlanner` pass `PERSON_PALETTE[i % 4]` paints every block by person — exactly what AS-067 forbids — with all 18 tests green. |
| AS-068 | **FAIL (major)** | Both tests are bare regexes over `stacked-planner.tsx` source (`/overflow-y-auto/`, `/max-h-\[/`); neither renders anything, neither reads `stacked-person-row.tsx`. Verified: `min-h-[6rem] shrink-0` → `min-h-0 shrink` plus `h-full`/`minHeight:0` on the inner grid makes rows compress to illegibility while both regexes still match. The load-bearing half of this assertion lives in the file the test never opens. |
| AS-069 | **FAIL (blocker)** | The F105 sweep is not falsifiable against the realistic failure mode. Every pattern requires a **literal digit adjacent to the unit**, so a computed value slips through; the word patterns are dodged by any other variable name; `week-agenda.tsx` and `calendar-block-chip.tsx` are in scope but absent from the file list; and source-only scanning cannot see an i18n key or a server-supplied string. Verified: rendering `` {`${bookedHours}h total`} · {`${headroomHours}h free`} · {`${loadPercent}% booked`} `` in `planner-header.tsx` puts "32h total · 8h free · 80% booked" on screen with all 18 tests green. |

Summary: **3 PASS, 14 FAIL (4 blocker / 8 major / 2 minor), 1 DEFERRED.**

---

## Cross-cutting findings

**1. The "composition test" does not compose.** `tests/unit/f102-calendar-page-composition.test.tsx` states in its own header: *"No source-text regex checks — every assertion here fails if the underlying behaviour regresses, regardless of how the page happens to be wired."* This is false. The file re-implements the page's call sequence by hand; `CalendarPage` is never imported or invoked. AS-001, AS-002, AS-014 and AS-023 all fail in precisely that gap.

**2. Regex guards have now failed three times in a row.** `tests/unit/f031-page-layout-derivation.test.tsx` documents that F090's and F100's regexes were each bypassed by a later regression — and the remedy each time was *another regex*. F104's `?? "all"` fix is guarded by nothing at all: the mutation reintroducing it is green.

**3. `buildBlockUserIds` is a vacuous helper.** `lib/calendar/workspace-members.ts:41` is `[...selectedUserIds]`. Testing it proves nothing about AS-001; its only value would be forcing the page through it, which only a regex attempts — and `buildBlockUserIds(selectedUserIds).length > 0 ? activeMemberIds : []` satisfies every one of those regexes while leaking the whole workspace.

**4. Test-id existence is standing in for behaviour.** Day header text, `data-date`, hour-line geometry, chip visibility and row grids are all asserted only by "a node with this test id exists." AS-018, AS-019, AS-024 and AS-062 are consequently satisfiable by a component that renders the wrong thing under the right ids.

**5. Timezone: the stacked layout and the week grid disagree.** `page.tsx` resolves the viewer's timezone and threads it into `buildCalendarWeek`, but `StackedPlanner` receives **no timezone prop** and `stacked-window.ts` is wholly UTC. The module's own header says *"callers are responsible for converting wall-clock hours to UTC before calling"* — its only caller does not. For any non-UTC viewer the stacked layout shows UTC 08:00–16:00 while labelling it 08:00–16:00, and buckets weekdays by UTC date. A Stockholm 08:30 Monday block (06:30 UTC) is silently hidden. This is a live product defect, not merely a test gap.

**6. Suite is red.** 133 failures across 41 files (architecture board, list inline-edit). **None are calendar or planner files** — they appear to predate M7 — but AS-075 cannot be satisfied at M8 until they are triaged. `tsc --noEmit` and `eslint . --max-warnings=0` are both clean.

**7. Error paths.** `getCalendarBlocks` throws on query error; `page.tsx` wraps `WeekGridSection` in `Suspense` only, no error boundary — a transient Supabase failure becomes a route-level error rather than a degraded Planner. Untested. `handleDragEnd` returns silently when `workspaceSlug`/`selfId` are absent (correct today, unguarded).

---

## Recommended follow-up features

**FU-A — Real `CalendarPage` invocation test (blocker; AS-001, AS-002, AS-014, AS-023).** Add one test that actually imports and awaits `CalendarPage` with `getCurrentUser`, `getRequestClient`, `getWorkspaceMembers`, `getCurrentUserTimezone`, `getCalendarBlocks` and `getTimeOffEntries` mocked, and asserts on observable outputs rather than on source spelling: for no query params, that `getCalendarBlocks` received exactly `[selfId]` as its `userIds` argument and that `WeekView` (not `StackedPlanner`) was rendered; for `?people=a,b`, that `StackedPlanner` was rendered with both ids in URL order; for narrowing back to one id, that `WeekView` returns. It must fail under all four of the mutations recorded above — `peopleParam ?? "all"`, `buildBlockUserIds(...).length > 0 ? activeMemberIds : []`, `resolvePlannerLayout(len + 1)`, and the `selfId` `unshift`. Once it exists, **delete** the seven `readPageSource`/`stripComments` regex assertions in `f031-page-layout-derivation.test.tsx`; they have provably never caught a real regression and their presence has repeatedly created false confidence.

**FU-B — Render-level AS-069 guard replacing the source sweep (blocker).** Delete `test_AS_069_no_capacity_figure_in_any_planner_file` and replace it with a rendered-DOM assertion: mount `PlannerHeader`, `WeekView` and `StackedPlanner` with realistic multi-block fixtures and assert that the resulting `container.textContent` contains no match for `/\d+\s*h\b/`, no `%` character, and none of the capacity vocabulary. A rendered assertion catches computed values, i18n strings and server-supplied props — all three of which the current sweep is blind to. If any residual source sweep is kept, it must include `week-agenda.tsx` and `calendar-block-chip.tsx`. The acceptance bar is the recorded mutation: `` {`${bookedHours}h total`} · {`${loadPercent}% booked`} `` in the header must turn the test red.

**FU-C — AS-067 at the integration point (blocker).** Render `StackedPlanner` itself with three members, each holding a block of a different `color`, and assert every chip's resolved `borderColor` equals its own `block.color`. The current tests render `StackedPersonRow` directly with one person and therefore cannot see a per-person palette injected one level up. The bar is the recorded `personColor` mutation.

**FU-D — Stacked layout renders what it claims (blocker/major; AS-019, AS-018, AS-024, AS-062, AS-063).** Assert on visible output rather than test-id existence: the five column headers read Mon–Fri in that order and carry the correct `data-date`; visible `08:00`…`15:00` hour labels exist (they currently do not exist at all — add them); a member with zero blocks still renders a `stacked-grid` subtree; the row label is `toBeVisible()`; and row order is asserted against the *rendered* sequence in a way that `flex-col-reverse` breaks. Add fixtures for two members sharing a name and for duplicate ids in `selectedUserIds` (which today collide on React keys and make `handleDragEnd`'s `indexOf` move the wrong row).

**FU-E — Pin the timezone and close the UTC/local split (major; AS-018, AS-021).** Two parts. (i) Set `env: { TZ: "UTC" }` in `vitest.config.ts` and add a second CI run at a negative offset such as `America/Los_Angeles`; remove the `beforeAll`-based `process.env.TZ` block at `planner-stacked-window.test.ts:267`, which V8 ignores and which currently advertises coverage it does not provide. (ii) Decide and record whether the stacked window is UTC or viewer-local. If viewer-local — which is what AS-018/AS-021 plainly imply and what the week grid already does — thread the resolved `timezone` from `page.tsx` through `StackedPlanner` into `clipBlockToStackedWindow`, and cover a Stockholm-viewer fixture where an 08:30 local Monday block must appear.

**FU-F — AS-020 boundary fixtures and AS-068 rendered scroll guard (major).** Add the exact-boundary cases the suite avoids — a block starting exactly at 16:00 and one ending exactly at 08:00 must each yield `[]` and render no chip — so the `<` vs `<=` mutant dies. Separately, replace both AS-068 source regexes with a rendered assertion covering `stacked-person-row.tsx`: the row carries a non-shrinking minimum height, the inner grid has a resolved pixel height, and with twelve members the total content height exceeds the container's max height. The bar is the recorded `min-h-0 shrink` + `h-full` mutation.

**FU-G — Minor hardening.** Register a `PointerSensor` gesture case (or at minimum assert both sensors are registered) so removing mouse/touch drag is detectable (AS-064). Make `handleDragEnd` preserve unknown query params instead of rebuilding `URLSearchParams` from scratch (AS-065). Add an error boundary around `WeekGridSection` so a Supabase failure degrades the Planner rather than the route.

**FU-H — Triage the 133 pre-existing unit failures** across 41 architecture/list test files before M8, since AS-075 gates on a green suite. Not an M7 blocker.

---

## Gate output

### `npx tsc --noEmit`
```
(no output — clean, exit 0)
```

### `npx eslint . --max-warnings=0`
```
(no output — clean, exit 0)
```

### `npx vitest run tests/unit`
```
 Test Files  41 failed | 477 passed | 1 skipped (519)
      Tests  133 failed | 3338 passed | 3 skipped (3474)
   Duration  87.76s
```

Failing files (none are calendar/planner):

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

### Validator's own AS-001 mutation re-verification

Mutation applied to `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:126`:

```ts
const selectedUserIds = parsePeopleParam(peopleParam ?? "all", {
```

```
 Test Files  4 passed (4)
      Tests  65 passed (65)
```

(`f102-calendar-page-composition`, `f031-page-layout-derivation`,
`planner-people-selection`, `planner-layout` — all green with the whole
workspace's blocks disclosed on a no-param load.) Mutation reverted; working
tree verified clean.
