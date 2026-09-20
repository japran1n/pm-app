# M3 scrutiny — pass 1

_Milestone: M3 — Data layer (F012, F013, F014)_
_Reviewed: 2026-09-20 · adversarial, read-only · nothing modified in the project tree_

## Verdict: **RED**

Two FAILs (one blocker, one major). GREEN requires zero FAILs.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-005 | PASS | — | `getCalendarBlocks(ws, s, e, [A])` returns only A's rows; restriction is a real `.in("user_id", …)` on the blocks query. Falsifiable at the query layer. |
| AS-006 | **FAIL** | major | The multi-user test calls `.sort()` on the result ids, so it cannot observe order at all; and `restrictedUserIds` is rebuilt from the `workspace_members` result set (which has no `.order()`), discarding the caller's `userIds` order on the first hop. The milestone brief's "in order" is unimplemented and untestable as written. |
| AS-029 | PASS | minor | `blocksInCalls` proves `.in()` fired on the blocks builder before the terminal `.order()`, and the empty-list case short-circuits with `dbHit === false`. One-directional: it does not prove nothing *also* filters post-fetch. |
| AS-030 | **FAIL** | blocker | The exclusion test fixture uses `status: "removed"`, a value the schema forbids. Mutation confirmed surviving (see below). |
| AS-031 | PASS | major | Falsifiable — mutation confirmed failing (see below). Fixture uses `status: "invited"`, which the schema can actually produce. Downgraded to "major" caveat, not a FAIL, because the `userIds === undefined` path bypasses narrowing entirely and is untested. |

## The blocker: AS-030's test asserts on an impossible row

`supabase/migrations/20260817222532_create_workspaces.sql:16`

```sql
status text not null default 'invited' check (status in ('invited', 'active')),
```

No later migration widens `workspace_members_status_check`. Grep across all
migrations for `'removed'` or `deactivat` returns zero hits. Removal is
implemented as a **row DELETE** via the `remove_workspace_member` SECURITY
DEFINER RPC (`lib/actions/workspaces.ts:853`). There is no deactivated state
in this product.

`tests/unit/switcher-member-source.test.ts` builds its central exclusion case
on `status: "removed"`. Mutation executed in a throwaway worktree:

```
-  (r) => r.status === "active" && r.user_id,
+  (r) => r.status !== "removed" && r.user_id,
```
→ `Test Files 1 passed (1) / Tests 3 passed (3)`

In production that mutation is equivalent to **no status filter at all**,
because `'removed'` can never occur. An `invited` row that has already been
backfilled with a `user_id` would then land in `result.active` and appear in
the switcher. The test cannot tell the difference. Additional surviving
mutations: dropping `id: row.id` from the mapped object (AS-030 names `id`
explicitly; `toMatchObject` only checks `userId`/`name`/`avatarUrl`), and
dropping `.eq("workspace_id", workspaceId)` — no fixture row carries a
foreign workspace id, so cross-workspace leakage into the switcher is
invisible.

Also: `membersError` is declared and reset in `beforeEach` but never set by
any test. The `throw error` branch in `members.ts:74-77` is dead scaffolding.

## AS-031 is genuinely falsifiable (the one thing that held up)

Mutation executed:

```
-  restrictedUserIds = (activeMembers ?? []).map(…).filter(…);
+  restrictedUserIds = userIds as string[];
```
→ `test_AS_031_deactivated_member_id_yields_no_blocks_even_when_passed` ×
   `test_AS_031_mixed_selection_only_returns_active_members_blocks` ×

Note the same mutation left **all five** of F012's tests green, so
`calendar-blocks-people-filter.test.ts` contributes nothing to AS-031; the
coverage rests entirely on `calendar-blocks-active-members.test.ts`.

## AS-031's remaining hole: the `undefined` path

When `userIds` is omitted, the active-member narrowing is skipped entirely
and every workspace block is returned, deactivated owners included. Nothing
tests this. Today the single caller
(`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:106,149`) always passes
a list, so AS-031 holds by accident of the call site rather than by
construction. RLS is not a backstop here: `is_active_workspace_member`
governs the *reader*, not the *block owner*. Make `userIds` required, or
apply the narrowing unconditionally.

## Mocks that model less than they appear to

`tests/unit/helpers/query-filter-mock.ts` is sound. The per-file chains are
not, and `calendar-blocks-people-filter.test.ts` is the weaker of the two:

- `lt`/`gt` are `() => builder` no-ops. The module's own header calls
  range-overlap (`starts_at < end AND ends_at > start`, not containment) its
  core invariant; swapping or deleting both predicates passes every test.
- `order()` ignores its arguments in both files. `ascending: false`, ordering
  by `ends_at`, or dropping `.order` entirely all pass.
- `eq` inspects only `workspace_id` in one file; no fixture row in either
  file carries a foreign workspace id, so both `.eq("workspace_id", …)`
  calls are deletable without failing anything.
- The members `.in()` is an `async` terminal in both files. Real PostgREST
  builders are chainable *and* thenable at every stage; reordering the real
  code to `.in(…).eq("status","active")` — semantically identical in
  Supabase — throws `builder.eq is not a function`. The mocks over-constrain
  call order while under-constraining semantics.
- Never exercised: duplicate ids, null `user_id` rows, non-UUID strings
  (real Postgres raises `22P02` on a junk id in `.in("user_id", …)`, so
  `getCalendarBlocks` would 500 rather than return `[]`), and list size
  caps (`?people=all` in a large workspace builds an unbounded IN list).

## Silent failures

Three distinct conditions produce an empty planner indistinguishable from
"no blocks this week", none tested:

1. `membersError` thrown — no test drives it; delete the `throw` and all
   eight blocks tests still pass (`activeMembers` null → `[]` → early return).
2. Blocks `error` thrown — same; `data ?? []` masks it.
3. RLS returning fewer `workspace_members` rows than expected →
   `restrictedUserIds` empty → `return []` with no error and no log. Fails
   closed, so not an AS-031 violation, but it is an untested degradation.

`resolvePeople` swallows both a `profiles` query error and a
`get_users_by_ids` RPC error — logged, execution continues, every member
resolves to `name: null, avatarUrl: null`. The switcher would render blank,
indistinguishable entries rather than erroring.

## Scope note: AS-005/AS-006 have no URL-level consumer

Both assertions are phrased `?people=…`. `parsePeopleParam`
(`lib/calendar/people-selection.ts`) is fully written and **nothing imports
it**; `searchParams.people` is never read. The calendar page passes
`blockUserIds={workspaceMembers.active.map(m => m.userId)}` with an in-code
comment deferring the real selection. Per plan.md this wiring is F031 (M7),
so it is not counted as an M3 failure — but it means AS-005/AS-006 are
closed only at the data layer, and F031 must re-close them end to end.

## Working-tree contamination (process finding)

The working tree is **dirty with uncommitted M4 application code** — modified
`calendar/page.tsx`, `week-agenda.tsx`, `week-time-grid.tsx`, `week-view.tsx`,
deleted `lib/calendar/resolve-filters.ts` and two test files. This breaks the
"workers must commit before exiting" rule and makes the milestone gate
unmeasurable in place.

Gates were therefore re-run in a clean detached worktree at HEAD:

| Gate | Working tree | HEAD (authoritative) |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| `eslint . --max-warnings=0` | **2 warnings → exit 1** | **clean, exit 0** |
| `vitest run tests/unit` | 45 files / 143 tests failed | 41 files / 133 tests failed |

HEAD matches the F001 baseline exactly (41 files / 133 tests, run-log.md:19).
**M3 introduced zero test or lint regressions.** The extra 4 files / 10 tests
and both lint warnings belong to the uncommitted M4 work.

## Recommended follow-up features

**F0xx — Re-base AS-030 on a state the schema can produce.** The switcher
member-source test must stop asserting on `status: "removed"`, which the
`workspace_members_status_check` constraint forbids. Decide what "deactivated"
means in this product: either add a migration introducing a real third status
value and widen the check constraint, or accept that removal is row deletion
and restate the test in those terms — a member row that is absent, plus an
`invited` row that has already been backfilled with a `user_id` (the real
leak vector), must both be excluded from `result.active`. Add a fixture row
belonging to a different `workspace_id` so the `.eq("workspace_id", …)` is
actually exercised, assert `id` is present and correct since AS-030 names it,
and add an error-path test driving the already-declared-but-unused
`membersError` so the `throw` branch stops being dead scaffolding. The
acceptance bar is that the mutation `r.status !== "removed"` fails the suite.

**F0xx — Make the block-query mock faithful enough to protect the module's
own invariants.** `calendar-blocks-people-filter.test.ts` stubs `lt`/`gt` as
no-ops and ignores `order()` arguments, leaving the range-overlap rule the
module's header calls its central design decision entirely unguarded, along
with the `starts_at ASC` ordering and both `workspace_id` scopes. Replace
that file's bespoke builders with the shared
`tests/unit/helpers/query-filter-mock` predicates already used by the F013
suite, add fixture rows that straddle each window boundary (starts before /
ends inside, spans the whole window, ends exactly at the start bound), add a
row in a foreign workspace, and record the `order()` arguments. The bar is
that deleting either `.eq("workspace_id", …)`, swapping the `lt`/`gt`
columns, or flipping `ascending` each fails at least one test.

**F0xx — Close the `userIds === undefined` leak in `getCalendarBlocks`.**
Omitting `userIds` skips active-member narrowing entirely and returns every
block in the workspace, deactivated owners included — the exact leak AS-031
forbids, prevented today only by the single call site happening to pass a
list. Either make the parameter required (updating the one caller and the
integration test) or apply the active-member narrowing unconditionally,
deriving the full active roster when no selection is given. Add a test
covering the no-argument path that asserts a non-active member's block is
absent, and decide explicitly whether `getCalendarBlocks` should validate
UUID shape rather than letting a junk id reach Postgres and raise `22P02`.

**F0xx — Cover the silent-failure paths in the block and member reads.**
Three conditions currently render an empty planner indistinguishable from a
genuinely empty week: a `workspace_members` query error, a `calendar_blocks`
query error, and RLS returning no membership rows for a caller who can
nonetheless read blocks. `resolvePeople` additionally swallows both of its
own failure modes and returns all-null names and avatars. Add tests that
drive each error branch and assert it throws (or, for the RLS-empty case,
logs distinguishably), so that deleting a `throw` is a test failure rather
than a behaviour change nobody notices.

**F0xx — Decide AS-006's ordering contract.** The contract text says only
"shows exactly those members' blocks"; the milestone brief glosses it as "in
order". The implementation preserves no order — `restrictedUserIds` is built
from an unordered `workspace_members` result — and the test `.sort()`s the
ids, so neither reading is verified. Either state that block ordering is
`starts_at` only and that person-order is F032's concern (AS-062/AS-063),
striking the phantom requirement, or thread the caller's `userIds` order
through and assert it without sorting.

**Process: require a clean tree at milestone boundaries.** M4 work was left
uncommitted across five application files while M3 was submitted for review.
Gates run in place were wrong in both directions.

---

## Gate output

### `npx tsc --noEmit` (working tree)
```
(no output — exit 0)
```

### `npx eslint . --max-warnings=0` (working tree — CONTAMINATED by uncommitted M4)
```
/Users/sasajapranin/Desktop/pm-app/app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
   29:10  warning  'getCalendarTasks' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  191:3   warning  'filters' is defined but never used. Allowed unused args must match /^_/u           @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)

ESLint found too many warnings (maximum: 0).
```

### `npx eslint . --max-warnings=0` (clean worktree at HEAD — AUTHORITATIVE)
```
(no output — exit 0)
```

### M3 unit tests
```
$ npx vitest run tests/unit/calendar-blocks-people-filter.test.ts \
                tests/unit/calendar-blocks-active-members.test.ts \
                tests/unit/switcher-member-source.test.ts

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  3 passed (3)
      Tests  11 passed (11)
   Duration  176ms
```

### `npx vitest run tests/unit` (working tree — CONTAMINATED)
```
 Test Files  45 failed | 465 passed | 1 skipped (511)
      Tests  143 failed | 3263 passed | 3 skipped (3409)
   Duration  87.41s
```

### `npx vitest run tests/unit` (clean worktree at HEAD — AUTHORITATIVE)
```
 Test Files  41 failed | 468 passed | 1 skipped (510)
      Tests  133 failed | 3273 passed | 3 skipped (3409)
```
Identical to the F001 baseline (run-log.md:19 — "41 test files failed, 133
tests failed (PRE-EXISTING)"). No M3 regression.

### Mutation runs (throwaway worktree, discarded)
```
# AS-030 — SURVIVES (bad)
-  (r) => r.status === "active" && r.user_id,
+  (r) => r.status !== "removed" && r.user_id,
 Test Files  1 passed (1)
      Tests  3 passed (3)

# AS-031 — CAUGHT (good)
-  restrictedUserIds = (activeMembers ?? []).map(…).filter(…);
+  restrictedUserIds = userIds as string[];
     × test_AS_031_deactivated_member_id_yields_no_blocks_even_when_passed
     × test_AS_031_mixed_selection_only_returns_active_members_blocks
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 6 passed (8)
```
