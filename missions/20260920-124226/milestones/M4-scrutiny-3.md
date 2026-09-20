# M4 Scrutiny — Pass 3 (targeted re-check of AS-034)

Scope of this pass, per orchestrator directive: re-verify **AS-034** only,
plus regression on AS-033, typecheck and lint. Working tree was restored to
a clean state after every mutation (`git status --porcelain -- app components`
returned empty).

## Assertion results

| ID | Verdict | Reason |
|----|---------|--------|
| AS-034 | **PASS** | `tests/unit/f016-calendar-page-no-task-query.test.ts` now extracts every `@/lib/queries/*` specifier from the 4 calendar source files and checks each against an explicit allowlist. Both mandated mutations were independently reproduced and both fail the suite. |
| AS-033 | **PASS** (no regression) | `tests/unit/f015-remove-task-strips.test.tsx` — 3/3 passing. |

**FAIL count: 0 → GREEN.**

## Mutation evidence (run by this validator, not taken from the handoff)

Baseline: `Test Files 1 passed (1) / Tests 7 passed (7)`.

| Mutation | Applied to | Result | Expected |
|---|---|---|---|
| `import { getMyTasks } from "@/lib/queries/my-tasks"` | `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` | `Tests 2 failed \| 5 passed` | FAIL — met |
| `import { getCalendarTasks } from "@/lib/queries/tasks"` | same file | `Tests 3 failed \| 4 passed` | FAIL — met |

The second mutation trips three independent guards (allowlist, forbidden-module
list, and the `getCalendarTasks` string guard), which is the behaviour the
allowlist rewrite was supposed to produce. The first trips two. The test is no
longer a mirror of the implementation: it constrains the set of permitted
dependencies rather than asserting the currently-present ones.

## Additional adversarial probe (not requested, reported for completeness)

| Mutation | Applied to | Result |
|---|---|---|
| `import { getMyTasks } from "../../lib/queries/my-tasks"` | `components/calendar/week-view.tsx` | **PASSED** (guard did not fire) |

`QUERY_IMPORT_RE` is anchored on the literal `@/lib/queries/` prefix, so a task
query reached through a relative specifier, a re-export barrel, or a dynamic
`await import()` is invisible to the guard. It is also a source-text guard over
exactly four hard-coded files: a task query pulled in transitively by any module
those files import is likewise not detected.

Severity: **minor**. It does not defeat AS-034 — the codebase uses the `@/`
alias by convention throughout, the realistic regression path is the one the
test catches, and `tsc` plus lint are clean. It is recorded as residual risk,
not a blocker, and does not hold the milestone.

## Recommended follow-up feature (non-blocking, post-milestone)

**Dependency-graph guard for the calendar subtree.** Replace the four-file,
prefix-matched source-text guard with a check that resolves the calendar page's
actual module graph — walk imports transitively from
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` (resolving both the `@/`
alias and relative specifiers through the tsconfig paths map), collect every
reachable module under `lib/queries/`, and assert the reachable set is a subset
of the allowlist. This closes the relative-path, barrel re-export and transitive
holes in one move, removes the need to hand-maintain a `FILES` array that will
silently stop covering the feature the moment a new calendar component is added,
and keeps the same allowlist semantics so the existing failure messages remain
useful. Keep the `getCalendarTasks` string guard as a cheap belt-and-braces
check.

## Tooling output

### `npx vitest run tests/unit/f016-calendar-page-no-task-query.test.ts`
```
Test Files  1 passed (1)
     Tests  7 passed (7)
  Duration  136ms
```

### `npx vitest run tests/unit/f015-remove-task-strips.test.tsx`
```
Test Files  1 passed (1)
     Tests  3 passed (3)
```

### `npx tsc --noEmit`
```
(no output)
exit 0
```

### `npx eslint . --max-warnings=0`
```
(no output — 0 lines)
exit 0
```

### `npx vitest run` (full suite)
```
Test Files  292 failed | 567 passed | 2 skipped (861)
     Tests  310 failed | 4503 passed | 1682 skipped (6495)
  Duration  169.12s
```

Full-suite failures were triaged and are **not** M4 regressions. The dominant
failure class traces to `tests/helpers/auth.ts` (lines 160, 199, 269, 277) with
`fetch failed` — the credential/network-gated integration suites against live
Supabase, the same environmental class already recorded in
`M4-scrutiny-2.md`. The `f015`/`f016`/`f017`/`f018` names appearing in the
failure list belong to a different mission's feature numbering (change
requests, sections/pages, discipline estimates), not to M4's calendar work.
Neither M4 test file appears in the failure set. The file/skip counts differ
from pass 2 (861/1682 vs 500/3) because that pass ran a narrower project
selection, not because coverage changed.
