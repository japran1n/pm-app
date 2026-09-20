# M3 scrutiny — pass 2 (re-check)

_Milestone: M3 — Data layer (F012, F013, F014) · remediation pass after F055 / F056_
_Reviewed: 2026-09-20 · adversarial, read-only · nothing in the project tree was modified_
_Authoritative tree: `886de034`. The working tree's tracked code is byte-identical to HEAD
(`git diff --name-only HEAD` outside `missions/` is empty), so the pass-1 "dirty with
uncommitted M4 code" contamination is resolved. All mutations were executed in a throwaway
detached worktree and reverted._

## Verdict: **GREEN**

Zero FAILs. Both pass-1 failures are genuinely fixed — verified by mutation, not by reading
the diff. Seven majors/minors are recorded below; none of them block M3.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-005 | PASS | — | Single-id selection returns only that user's row; catches both the dropped-`.in()` mutation and the widened-`.in()` mutation. Falsifiable in both directions. |
| AS-006 | **PASS** | major | `.sort()` on result ids is gone; set membership is asserted as `toHaveLength(2)` + `arrayContaining`. Under-inclusion is caught (mutation C3). Over-inclusion is caught by the AS-005 and `.in()`-args tests, **not** by the AS-006-named test itself — see below. |
| AS-029 | PASS | — | Post-fetch filtering substituted for the db-level `.in()` fails `test_AS_029_the_restriction_is_applied_inside_the_query_via_in_clause`. Empty selection short-circuits with `dbHit === false`. |
| AS-030 | **PASS** | major | The required mutation `r.status !== "removed"` now **fails** the suite. Three further pass-1 surviving mutations (drop `.eq("workspace_id")`, drop `id: row.id`, drop `throw error`) are all caught too. |
| AS-031 | PASS | major | Replacing the active-member narrowing with the raw caller list fails two tests. The `userIds === undefined` path remains unnarrowed and untested (carried over from pass 1). |

## The two re-checks, in detail

### AS-030 — fixed, and the fix is load-bearing

Required mutation, applied to `lib/queries/members.ts:79-81`:

```
-  (r) => r.status === "active" && r.user_id,
+  (r) => r.status !== "removed" && r.user_id,
```

```
FAIL  tests/unit/switcher-member-source.test.ts > getWorkspaceMembers — switcher member
      source (AS-030) > excludes an invited row even after user_id has been backfilled
      (accepted-but-still-invited leak vector)
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**Mutation caught.** The kill comes from the right place: the `invited`-row-with-a-backfilled-
`user_id` fixture is a state the `workspace_members_status_check` constraint can actually
produce, so the test now discriminates the real leak vector rather than an impossible one.

The three other mutations that survived pass 1 are now all caught (one failing test each):

| Mutation | Pass 1 | Pass 2 |
|---|---|---|
| `r.status !== "removed"` | survived | **caught** |
| drop `.eq("workspace_id", workspaceId)` | survived | **caught** |
| drop `id: row.id` from the mapped member | survived | **caught** |
| replace `throw error` with a log-only branch | survived (dead scaffolding) | **caught** |

`membersError` is no longer dead — `propagates an error when the workspace_members query
fails` drives it.

### AS-006 — fixed, with one honest limit

`.sort()` on result ids is gone. The assertion is now:

```js
expect(resultIds).toHaveLength(2);
expect(resultIds).toEqual(expect.arrayContaining(["block-a1", "block-b1"]));
```

That is correct set equality, unmasked. Mutation C3 (`restrictedUserIds.slice(0, 1)` — honour
only the first requested id) fails `test_AS_006_multiple_userIds_returns_blocks_for_all_specified_users`
and nothing else, which is exactly the discrimination AS-006 needs on the inclusion side.

**The limit (major, not a FAIL):** `ALL_ROWS` contains exactly two rows, one per requested
user. There is no third member's block in the fixture universe, so the AS-006-named test
cannot observe a *leak*. Deleting `query = query.in("user_id", restrictedUserIds)` entirely
(mutation C1) fails four tests — but none of them is the AS-006 test, because the
whole-workspace result *is* the two-row fixture. The "exactly" half of AS-006 is therefore
carried by `test_AS_005_...` (which has `USER_B` present and excluded) and by
`test_AS_029_the_restriction_is_applied_inside_the_query_via_in_clause` (exact `.in()` args).
Mutation C7 — widening `.in()` by one extra id — fails both of those. The behaviour AS-006
names is protected; the test that bears its name only protects half of it.

## Full mutation battery (all reverted)

| # | Mutation | Result |
|---|---|---|
| M1 | `r.status === "active"` → `r.status !== "removed"` | **caught** (1 failed) |
| M2 | drop `.eq("workspace_id", workspaceId)` in `members.ts` | **caught** (1 failed) |
| M3 | drop `id: row.id` from the mapped active member | **caught** (1 failed) |
| M4 | replace `throw error` with log-only in `members.ts` | **caught** (1 failed) |
| C1 | delete the blocks `.in("user_id", restrictedUserIds)` | **caught** (4 failed) |
| C2 | move the restriction post-fetch (`data.filter(...)`) | **caught** (1 failed — AS-029) |
| C3 | `restrictedUserIds.slice(0, 1)` | **caught** (1 failed — AS-006) |
| C4 | swap the `lt`/`gt` range-overlap columns | **caught** (2 failed, via the sibling active-members file) |
| C6 | skip the active-member narrowing (`restrictedUserIds = userIds`) | **caught** (2 failed — AS-031) |
| C7 | widen `.in()` with one extra id | **caught** (2 failed — AS-005, AS-029) |
| **C5** | **`.order("starts_at", { ascending: false })`** | **SURVIVED — 8 passed** |

## Findings that do not block M3

**major — result ordering is unprotected, and the ordering assertion is tautological.**
`tests/unit/calendar-blocks-people-filter.test.ts` compares `startsAtTimes` to
`[...startsAtTimes].sort(...)` — a sorted copy of itself, over a fixture already stored
ascending — while both files' mock `order()` ignores its column and direction arguments.
Flipping to `ascending: false`, ordering by `ends_at`, or deleting `.order` outright passes
every test (mutation C5). The F056 handoff claims ordering is now asserted; it is not.
This is **not** an AS-006 failure — AS-006's contract text is set semantics ("shows exactly
those members' blocks") and says nothing about order — but the claim should not stand
unchallenged.

**major — "deactivated" is a state this schema cannot produce.** AS-030 says "deactivated or
removed". `supabase/migrations/20260817222532_create_workspaces.sql:16` constrains
`status in ('invited','active')`; no later migration widens it; removal is a hard DELETE in
`public.remove_workspace_member`. Half of AS-030's wording describes a state that does not
exist. The F055 test now says so explicitly in a comment and tests the schema-true cases
instead, which is the right call given the contract is immutable — but the gap should be
closed by a migration or by an explicit decision recorded in the mission.

**minor — one test in the AS-030 file asserts nothing.** `excludes a removed member because
their row is absent` (`switcher-member-source.test.ts:108-131`) has a fixture containing only
the active member, so its two assertions are effect-identical to the preceding test. With
removal modelled as row absence, the test has no removed member to be absent. It is honest
documentation of the schema, but it is not a test; no mutation can fail it.

**major — the `userIds === undefined` leak survives from pass 1.** Omitting `userIds` skips
active-member narrowing entirely and returns every block in the workspace. Prevented today
only by the single call site happening to pass a list. Unchanged since pass 1.

**minor — silent-failure paths remain untested in the blocks read.** The blocks-query `error`
branch and the `resolvePeople` swallow-and-continue paths are still undriven. The members-query
error branch is now covered (M4 caught).

**minor — an `active` row with a null `user_id` disappears.** `members.ts:79-81` excludes it
from `activeRows` (needs `r.user_id`) and from `pendingRows` (needs `status === "invited"`).
`user_id` is nullable and nothing constrains `status='active' ⇒ user_id not null`, so such a
member vanishes from the UI with no log and no error. No fixture drives it.

**scope (unchanged, not an M3 failure) — `?people=` has no consumer.** `parsePeopleParam`
(`lib/calendar/people-selection.ts`) is still imported by nothing; the calendar page passes
every active member's id as `blockUserIds`. There is no people-switcher component. AS-005,
AS-006 and AS-030 are closed at the data layer only. Per plan.md this wiring is F031 (M7),
which must re-close all three end to end.

## Recommended follow-up features

**Make the calendar-block query mock enforce the predicates it stands for.** The mock in
`tests/unit/calendar-blocks-people-filter.test.ts` stubs `lt` and `gt` as no-ops and discards
`order()`'s arguments, leaving the `starts_at ASC` ordering entirely unguarded (mutation C5
survives) and the range-overlap rule guarded only incidentally by the sibling
`calendar-blocks-active-members.test.ts`. Replace the bespoke builders with the shared
`tests/unit/helpers/query-filter-mock` predicates, record `order()`'s column and direction and
assert on them, and replace the self-comparing sort assertion (`startsAtTimes` vs. a sorted
copy of itself) with an assertion against an explicitly-written expected sequence over a
fixture deliberately stored out of order. The acceptance bar is that flipping `ascending`,
changing the order column, or deleting `.order` each fails at least one test.

**Give the AS-006 test a fixture universe large enough to observe a leak.** `ALL_ROWS` today
contains exactly the two blocks the test asks for, so `toHaveLength(2)` cannot detect
over-inclusion and deleting the blocks `.in()` leaves the AS-006-named test green. Add a third
member's block, a block belonging to a different workspace, and a block outside the requested
time window, then assert the exact id set for a two-of-four selection. The bar is that
deleting `query.in("user_id", restrictedUserIds)` fails the AS-006 test specifically, not just
its neighbours.

**Decide what "deactivated" means, or record that it does not exist.** AS-030's wording
presumes a deactivated state the `workspace_members_status_check` constraint forbids and that
no code produces. Either add a migration introducing a third status value with the constraint
widened, the removal RPC changed from DELETE to a status update, and the switcher and
`getCalendarBlocks` narrowing updated to exclude it; or write a short decision record stating
that removal is row deletion in this product, so the "deactivated" half of AS-030 and AS-031
is satisfied vacuously. Also delete or rewrite the no-op `excludes a removed member because
their row is absent` test, which currently asserts nothing.

**Close the `userIds === undefined` leak and the null-`user_id` silent drop.** Omitting
`userIds` from `getCalendarBlocks` bypasses active-member narrowing and returns every block in
the workspace, including those of members who are no longer active — the exact leak AS-031
forbids, prevented today only by the one call site happening to pass a list. Make the
parameter required or apply the narrowing unconditionally, and add a test over the
no-selection path asserting a non-active member's block is absent. Separately, in
`getWorkspaceMembers`, an `active` row whose `user_id` is null is dropped from both the active
and the pending list and disappears silently; either log it or surface it, and add a fixture.

**Cover the remaining silent-failure paths in the blocks read.** The `calendar_blocks` query
error branch and both of `resolvePeople`'s swallowed failure modes still render an empty or
all-null planner indistinguishable from a genuinely empty week. Add tests that drive each
branch and assert it throws or logs distinguishably, so that removing a `throw` is a test
failure rather than a behaviour change nobody notices. The members-query error branch is
already covered by F055 and can serve as the pattern.

---

# Gate output

Code in the working tree is byte-identical to HEAD (`886de034`) for all tracked non-mission
files, so gates were run there. A detached worktree at HEAD was used for the mutation runs;
note that `tsc` in a bare worktree reports a spurious
`app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'` because Next.js's
generated `.next/types` are absent — the authoritative run below is clean.

## `npx tsc --noEmit`

```
TSC_EXIT=0
```

Clean, no diagnostics.

## `npx eslint . --max-warnings=0`

```
ESLINT_EXIT=0
```

Clean, zero output, zero warnings.

## `npx vitest run tests/unit`

```
 Test Files  41 failed | 469 passed | 1 skipped (511)
      Tests  133 failed | 3280 passed | 3 skipped (3416)
   Duration  86.19s
VITEST_EXIT=1
```

41 files / 133 tests failing is **exactly** the F001 recorded baseline (run-log.md:19) and
exactly the pass-1 HEAD figure. Every failing file belongs to the pre-existing legacy
sitemap / page-column / board-DnD cluster; no M3 file appears among them:

```
f003-page-client-visibility-toggle.test.tsx      f034-component-panel.test.tsx
f003-section-client-visibility-toggle.test.tsx   f035-component-detail.test.tsx
f006-section-card-menu-kind-row.test.tsx         f036-rename-delete-panel.test.tsx
f007-cms-badge-section-card.test.tsx             f044-page-column-slug-editor.test.tsx
f008-section-card.test.tsx                       f045-create-page-dialog-page-kind.test.tsx
f009-board-layout.test.tsx                       f048-component-panel-dnd.test.tsx
f011-slug-proposal.test.ts                       f060-discipline-estimate-schema.test.tsx
f013-create-section.test.tsx                     f081-board-performance.test.tsx
f014-rename-page.test.tsx                        f083-note-validation-ui.test.tsx
f015-rename-section.test.tsx                     f084-keyboard-accessibility.test.tsx
f016-change-page-kind.test.tsx                   f085-sortable-section-list-details-data.test.tsx
f017-delete-section.test.tsx                     f096-invalidate-details-chain.test.tsx
f018-delete-page.test.tsx                        f097-page-column-header-icon-state.test.tsx
f020-reorder-sections.test.tsx                   f104-page-column-chain.test.tsx
f022-reorder-columns.test.tsx                    f250-list-inline-edit.test.tsx
f023-keyboard-dnd.test.tsx                       list-due-date-cell-empty-state.test.tsx
f024-drag-cancellation.test.tsx                  list-due-date-cell-optimistic.test.tsx
f024-section-card-details-data.test.tsx
f025-section-card-node-meta-icon.test.tsx
f026-component-picker.test.tsx
f026-meta-bound-to-section.test.ts
f027-instance-display.test.tsx
f032-visual-distinction.test.tsx
f033-hover-highlighting.test.tsx
```

**M3 introduced zero test, lint or type regressions.**

## M3 test files at HEAD

```
npx vitest run tests/unit/switcher-member-source.test.ts \
               tests/unit/calendar-blocks-people-filter.test.ts \
               tests/unit/calendar-blocks-active-members.test.ts

 Test Files  3 passed (3)
      Tests  15 passed (15)
   Duration  181ms
```
