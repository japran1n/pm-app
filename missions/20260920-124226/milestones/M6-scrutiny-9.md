# M6 — The people switcher — scrutiny pass 9

Date: 2026-09-20
Scope: targeted re-review of AS-052 after F087, plus full-suite / lint /
typecheck regression check for M6.
Verdict: **GREEN (conditional)** — AS-052 now falsifiable; 1 residual
`major` (untested call-site wiring). No blockers.

Method: read `lib/calendar/workspace-members.ts`,
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`,
`tests/unit/f029-switcher-url-wiring.test.tsx`,
`tests/unit/switcher-member-source.test.ts`,
`tests/unit/people-switcher.test.tsx` cold, then ran two real mutations
(apply -> run -> restore) and a clean-tree baseline of the entire suite so
that pre-existing failures could be separated from M6 ones. All vitest runs
used `--no-cache`. Working tree verified clean (only the pre-existing
`plan.md` / `next-env.d.ts` modifications) before and after mutation work.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-052 | **PASS (major)** | Mutation `active = [...active, ...pending]` inside `buildSwitcherMembers` **kills** `test_AS_052_only_active_members_reach_switcher_and_allowlist` (expected length 2, got 3). Falsifiability confirmed. Residual major: nothing pins `page.tsx` to the helper — see below. |
| AS-011 | INCONCLUSIVE | DEFERRED (loop guard). Not re-raised per instruction. |
| AS-055 | INCONCLUSIVE | DEFERRED (ResizeObserver not testable in jsdom). Not re-raised. |
| AS-056 | INCONCLUSIVE | DEFERRED to M7/F031. Not re-raised. |
| AS-059 | INCONCLUSIVE | DEFERRED to M7/F031. Not re-raised. |
| AS-012, AS-013, AS-051, AS-053, AS-054, AS-057, AS-058, AS-060, AS-061 | PASS (carried) | Not re-mutated this pass (pass 8 verdicts stand); all owning test files re-run green on a clean tree. |

## AS-052 — what the code actually does

Three independently tested layers now stand between the database and the
switcher's rendered list:

1. `getWorkspaceMembers` (`lib/queries/members.ts`) classifies rows by
   `status === "active"`, not by presence of `user_id`.
   `tests/unit/switcher-member-source.test.ts` (7 passing) pins the real
   leak vector: an `invited` row whose `user_id` was backfilled after the
   invitee accepted must stay out of `.active`. A `status !== "removed"`
   style mutation dies on that case.
2. `buildSwitcherMembers` (`lib/calendar/workspace-members.ts`) reads only
   `.active` and produces both outputs (`switcherMembers` and
   `activeMemberIds`) from that one array, so the switcher list and the
   `?people=` allowlist cannot desync. Verified by mutation (below).
3. `PeopleSwitcher` renders each member with avatar and name —
   `test_AS_052_lists_active_members_with_avatar_and_name` in
   `tests/unit/people-switcher.test.tsx`.

This is a genuine improvement over pass 8: the guard is a data-flow
assertion on a real exported function, not a regex over source text, so it
cannot be defeated by a decoy comment or a cosmetic refactor of the call
site.

### Mutation log

| # | Mutation | Expected | Observed |
|---|---|---|---|
| 1 | In `buildSwitcherMembers`, `const active = [...workspaceMembers.active, ...(workspaceMembers.pending ?? [])]` | test fails | **CAUGHT** — `f029-switcher-url-wiring.test.tsx:377`, `expected [...] to have a length of 2 but got 3`. 1 failed / 15 passed. |
| 2 | In `page.tsx`, replace the `buildSwitcherMembers(...)` call with an inline `[...active, ...pending]` re-derivation (`void buildSwitcherMembers;` to keep the import live) | test should fail | **SURVIVED** — full suite failure count identical to clean baseline (310/310). No test observes that the page uses the helper. |

Tree restored after each mutation; `git status --porcelain` matches the
session-start snapshot.

### Residual finding — `major`, not a blocker

Mutation 2 is the remaining hole. `buildSwitcherMembers` exists precisely to
be the single decision point, but no test asserts that the calendar page
routes through it. The three test files that reference
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` read it as *text* and
only check the `buildPlannerNavHrefs` import (F080/AS-011), the browser-
storage scan (AS-013), and the no-task-query scan (F016). A future refactor
that inlines the member mapping back into the page — the exact desync F087
was written to prevent — reintroduces the pending-invite leak with a fully
green suite.

I am recording this as `major` (met but fragile) rather than `blocker`
because every layer of the actual shipped data path is individually
falsifiable today, and defeating the coverage requires deliberately writing
new buggy code in a place that now has no reason to be edited. It is not the
pass-8 situation, where the *shipped* code was guarded by a test that was
tautological on arrival.

## Full-suite context (important)

The repository's full vitest run is **red at baseline**, independent of M6:
310 failed / 4570 passed / 1682 skipped, across 6562 tests. The mutated run
in mutation 2 produced the identical 310. The failures cluster in
DB-integration and other-mission suites (`recurrence-sql-parity`,
`change-member-role`, `db-task-keys`, `workspace-role-expansion`,
`remove-member`, `f025-section-card-node-meta-icon`, `f026-component-picker`,
`f027-instance-display`, `f081-board-performance`,
`f084-keyboard-accessibility` [the *portal* F084, not M6's],
`f085-sortable-section-list-details-data`, ...) — none of these are M6 files.

Every M6-owned test file is green:

```
f016-calendar-page-no-task-query.test.ts      7 pass / 0 fail
f029-switcher-url-wiring.test.tsx            16 pass / 0 fail
f080-calendar-nav-hrefs.test.tsx              5 pass / 0 fail
people-switcher-multiselect.test.tsx         14 pass / 0 fail
people-switcher-placement-a11y.test.tsx       5 pass / 0 fail
people-switcher.test.tsx                     10 pass / 0 fail
switcher-member-source.test.ts                7 pass / 0 fail
                                     total   64 pass / 0 fail
```

The baseline redness is outside M6's scope but it means **the milestone gate
cannot be "the suite is green"** — it has to be a named file list, or the
gate is meaningless. Flagging for the orchestrator.

## Recommended follow-up features

**FU-A (major) — pin the calendar page's member derivation to the helper.**
Add a test that proves `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
obtains `switcherMembers` and `activeMemberIds` from `buildSwitcherMembers`
and from nowhere else, in a way that survives reformatting. The strongest
available form without rendering a server component: import the page module
with `@/lib/calendar/workspace-members` mocked via `vi.mock`, invoke the
default export with stubbed Supabase/auth, and assert the spy was called
once with the object returned by `getWorkspaceMembers`, plus assert that the
`switcherMembers` prop handed to `PeopleSwitcherUrlBound` is referentially
the spy's return value. If invoking the async server component proves
impractical under the existing mock harness, the acceptable fallback is a
source-level assertion that the file contains no `.active.map(` and no
`.pending` reference at all — a negative scan, which unlike the deleted
pass-8 positive regex cannot be satisfied by a decoy. The test must fail
under the mutation recorded as #2 above.

**FU-B (minor) — establish a named M6 gate file list.** Record, in the
mission state, the exact set of test files that constitute the M6 gate
(the seven listed above plus the Playwright AS-061 spec), and have the
milestone check run only those. Today a full-suite invocation returns 310
pre-existing failures, so a human or agent reading "tests fail" gets no
signal about M6 at all. Include in the same feature a short note recording
that the baseline is red and why, so a later pass does not mistake it for a
regression introduced by calendar work.

**FU-C (minor) — pre-existing suite rot, separate mission.** The 310
baseline failures should be triaged out of M6 entirely. They are not this
milestone's debt, but they are accumulating and they currently make every
full-suite signal in this repository unusable.

---

## Appendix — raw tool output

### Typecheck

```
$ npx tsc --noEmit
tsc exit=0
```

Clean.

### Lint

```
$ npm run lint

> pm-app@0.1.0 lint
> eslint

```

Clean — no errors, no warnings.

### Mutation 1 (buildSwitcherMembers admits pending) — CAUGHT

```
$ npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx --no-cache

 FAIL  tests/unit/f029-switcher-url-wiring.test.tsx > F087 (AS-052): buildSwitcherMembers excludes pending members from both outputs > test_AS_052_only_active_members_reach_switcher_and_allowlist
AssertionError: expected [ { userId: 'u1', ...(3) }, ...(2) ] to have a length of 2 but got 3

- Expected
+ Received

- 2
+ 3

 > tests/unit/f029-switcher-url-wiring.test.tsx:377:36
    375|
    376|     // switcherMembers must be exactly the active list
    377|     expect(result.switcherMembers).toHaveLength(2);
       |                                    ^
    378|     expect(result.switcherMembers.map((m) => m.userId)).toEqual(["u1",...
    379|     // pending member must not appear

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
   Duration  1.04s
```

### Mutation 2 (page.tsx bypasses the helper) — SURVIVED

```
$ npx vitest run --no-cache     # with page.tsx inlining [...active, ...pending]

 Test Files  292 failed | 578 passed | 2 skipped (872)
      Tests  310 failed | 4570 passed | 1682 skipped (6562)
   Duration  175.17s
```

### Clean-tree baseline — identical failure count

```
$ npx vitest run --no-cache

numTotalTests 6562  failed 310  passed 4570  pending 1682
```

Top baseline failure clusters (file, count):

```
16 recurrence-sql-parity.test.ts
15 change-member-role.test.ts
12 db-task-keys.test.ts
11 workspace-role-expansion.test.ts
10 remove-member.test.ts
 9 change-workspace-slug.test.ts
 9 f025-section-card-node-meta-icon.test.tsx
 8 db-subtasks.test.ts
 8 f116-task-types.test.ts
 7 delete-workspace.test.ts
 7 invite-member.test.ts
 7 rename-workspace.test.ts
 7 f044-page-column-slug-editor.test.tsx
 7 f084-keyboard-accessibility.test.tsx   (portal F084, not M6)
 6 f126-auth-pool.test.ts
```

None are M6 files. Mutation-2 total == baseline total, which is the
evidence for the SURVIVED verdict.
