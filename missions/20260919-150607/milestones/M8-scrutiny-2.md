# M8 Scrutiny — pass 2 — **GREEN (with follow-ups)**

_Date: 2026-09-20 · Features F045, F046, F047, F048 + fixes F116–F121 · Assertions AS-152…AS-156, AS-159…AS-164 (+ AS-006 gate)_

Process note carried forward from pass 1: this mission still has **no
`validation-contract.md` on disk**. Assertion text was reconstructed from
`missions/20260919-150607/features/F04*.md` and `plan.md`. That remains a
process defect — the contract is supposed to be the immutable source of truth
and a validator should not have to infer it.

Every verdict below is backed by a **mutation experiment**: the behaviour was
deliberately broken, the test re-run, and the working tree restored
(`git status` over `components/ lib/ tests/` clean afterwards). A verdict of
PASS means the test actually went red under mutation, not that it is green
today.

## Verdicts

| ID | Verdict | Reason |
|---|---|---|
| AS-006 | **PASS** | `npx tsc --noEmit` → exit **0**. The two TS2556/TS2322 errors in `tests/unit/f048-component-panel-dnd.test.tsx` are gone (F116 typed the `reorderComponents` mock wrapper and gave the fixture a concrete `position`). `npm run lint` → exit 0 (7 warnings, 0 errors, none in M8 files). Test-suite leg: see "Pre-existing failures" — unchanged baseline, no M8 regression. |
| AS-152 | PASS | Deleting `<PageKindSelector>` from `create-page-dialog.tsx` turns `f045-create-page-dialog-page-kind.test.tsx` red (3 failed). Queried by accessible name, not by snapshot. |
| AS-153 | PASS | Flipping the initial state to `"cms"` reds exactly the AS-153 test. Asserts `aria-selected` on the rendered option — observable state, not the initializer. |
| AS-154 | PASS | Hardcoding `page_kind: "static"` in the submit call reds exactly the AS-154 test. The test deliberately selects `cms` (≠ default), so the assertion is not vacuous. |
| AS-155 | **PASS** (was blocker) | Now covered *at the action level*, which is what the assertion is about. `f010-create-page-action.test.ts::test_AS_031...` calls `createPage(projectId, { name, slug })` with no `page_kind` and asserts the value off the inserted row; the mock echoes the real insert payload. Both action-level mutations — dropping `page_kind` from the `tasks` insert, and overriding it to `"cms"` — turn it red. The type-level contradiction is resolved: `CreatePageInput` is now `z.input<typeof createPageSchema>`, so omitting `page_kind` is legal for real callers and the `as never` cast is gone. |
| AS-156 | PASS | Making `page_kind` required reds 3 tests; changing `.default("cms")` reds the same 3. The assertion now pins the default *value*, not just its presence (F117 added `expect(result.data.page_kind).toBe("static")`). |
| AS-159 | PASS | `reorderComponents` exported from `lib/actions/architecture.ts`; test imports through the barrel. |
| AS-160 | **PASS** (was major) | Two guards now stand: `reorderComponentsSchema.componentIds` carries `.refine(ids => new Set(ids).size === ids.length)`, and the action adds a length-vs-row-count check after the set-membership check. I probed pass 1's exact hole directly — a 2-component project sent `[A, A, B]` — and the action now returns `success: false` with **zero** upsert calls. Verified empirically with a throwaway probe test (since deleted). |
| AS-161 | **PASS** (was major) | Both halves fixed. (a) The write is now a single `admin.from("page_components").upsert(rows, { onConflict: "id" })` — one statement, atomic at the DB level — replacing the `Promise.all` fan-out that could commit a partial reorder. (b) The test now records the `(id, position)` rows and asserts exact pairing against a submitted order (`COMP_3, COMP_1, COMP_2`) that deliberately differs from DB row order. Mutation: rewriting positions in DB order reds the test (1 failed / 4 passed). |
| AS-162 | **PASS** (was blocker) | `f048-component-panel-dnd.test.tsx` now spies on the **real** `SortableContext` export (via `importActual` + delegate, so dnd-kit behaviour is unchanged) and asserts `items: ["comp-a","comp-b","comp-c"]`. Mutation confirmed independently by me: replacing `<SortableContext …>` with a bare fragment reds the AS-162 test (1 failed / 3 passed). The assertion is now genuinely falsifiable. |
| AS-163 | PASS (major caveat stands) | `handleDragEnd` is captured from the real render, `arrayMove` path exercised, and a failure-path test was added. Caveat unchanged from pass 1: the drag handle's `{...listeners}` spread, the sensor config, and real pointer/keyboard dragging are still untested. The row could be undraggable in a browser and every test stays green. No E2E drag coverage. |
| AS-164 | **PASS** (was major gap) | The `void …then()` with no `.catch` is gone. `handleDragEnd` now wraps the call in `useTransition` and branches on `result.success`: failure fires `toast.error(result.error ?? …)` and **returns without** `router.refresh()`. The new test asserts both legs. Mutation: removing the `!result.success` guard (always refresh) reds the test (1 failed / 3 passed). `isReorderPending` also disables the drag handles mid-flight. |

## Severity summary

- **blocker**: none.
- **major**:
  - **AS-163 — no real drag coverage.** Every test invokes `onDragEnd` directly. Nothing proves a user can actually initiate a drag: `{...attributes} {...listeners}` could be deleted from the grip button and all four tests stay green.
  - **AS-161 — silent `name` fallback is a data-loss hazard.** The upsert payload carries `name: existingComponentById.get(id)?.name ?? ""`. If the `select("id, name, project_id")` is ever narrowed back to `select("id")` — a plausible future edit, since `name` is only there to satisfy a type — every component in the project is silently renamed to the empty string on the next reorder. `tsc` would not catch it and the m8 test would not either: the test's mock returns rows of `{ id }` only, so it *already* exercises the `?? ""` branch and passes.
  - **Rejected-promise path still untested.** `startReorderTransition(async () => { const result = await reorderComponents(...) })` has no `try/catch`. The new test covers `success: false`, not a *thrown* server action (network failure, serialization error). That still surfaces as an unhandled rejection inside the transition with no toast.
- **minor**:
  - `f046-create-page-schema-page-kind-optional.test.ts` now contains two tests (AS-155, AS-156) with **byte-identical bodies**. AS-155's real coverage lives in f010; the duplicate reads as coverage that isn't there.
  - The AS-160 duplicate-id *test* (`[COMP_1, COMP_1, COMP_2]` against a 3-component project) is caught by the pre-existing set-size completeness check, not by the new uniqueness guard — deleting the `.refine` leaves all 5 tests green. The implementation is correct (I verified the true hole separately), but the test does not pin the new guard.
  - Nothing rejects an invalid `page_kind` string at the schema level; nothing asserts `resetAndClose()` restores `pageKind` to `static` on reopen.
  - Carried from pass 1, not fixed: orphaned `<Label htmlFor="page-kind">` with no matching id in `create-page-dialog.tsx`; `ComponentPanel`'s `projectId?: string = ""` default, which turns a missing project id into a silent empty-string call to a server action whose schema then rejects it as a non-uuid.

## Recommended follow-up features

**Prove the drag handles are actually wired (AS-163).** Every current test bypasses dnd-kit by invoking the captured `onDragEnd` directly, so the `{...attributes} {...listeners}` spread on the grip button in `ComponentListItem` is protected by nothing — delete it and the suite stays green while the panel becomes undraggable in a browser. Add either a jsdom-level assertion that the grip button carries dnd-kit's contributed props (`role`, `tabIndex`, `aria-roledescription`, `aria-describedby`, and a pointer/keydown listener) and that removing the spread reds the test, or — better — a Playwright test that performs a real keyboard-initiated sort (space, arrow-down, space) on the Components panel and asserts the persisted order after reload. Prove the fix by mutation: remove the listener spread and show the new test goes red.

**Remove the silent `name` fallback from the reorder upsert (AS-161).** `lib/actions/architecture/components.ts` builds each upsert row with `name: existingComponentById.get(id)?.name ?? ""`. The empty-string fallback exists only to satisfy the generated Supabase Insert type, but if it ever fires it blanks every component name in the project — a destructive write hidden behind a `??`. Replace it with an explicit guard that aborts the reorder and logs if any submitted id has no fetched row (which is already impossible after the completeness check, so the guard should be unreachable by construction), and fix the m8 test's `page_components` select mock to return `{ id, name, project_id }` so the test stops silently exercising the fallback branch. Consider instead a dedicated Postgres RPC that takes `(project_id, ordered_ids uuid[])` and updates positions in one statement, which removes the need to echo `name`/`project_id` at all.

**Cover the thrown-server-action path in `handleDragEnd` (AS-164).** F121 added the `result.success === false` branch, but a server action that *rejects* — network drop, serialization failure, an exception escaping `reorderComponents` before it can return `MutationResult` — still produces an unhandled rejection inside `startReorderTransition` with no toast and no recovery. Wrap the awaited call in `try/catch` and surface the same error toast, and add a test with `reorderComponentsMock.mockRejectedValueOnce(new Error("boom"))` asserting `toast.error` fires and `router.refresh()` is not called.

**Tighten the AS-160 duplicate test and deduplicate the AS-155/156 schema tests (minor).** The AS-160 duplicate case currently submits 2 distinct ids against a 3-component project, so it is caught by the older set-size check and passes even with the new `.refine` deleted; change it to the case the guard actually exists for — a 2-component project sent `[A, A, B]` — so the uniqueness refinement is pinned by a test. Separately, `f046-create-page-schema-page-kind-optional.test.ts` has two byte-identical test bodies named AS-155 and AS-156; collapse them or give the AS-155 slot a distinct schema-level behaviour (e.g. rejecting an invalid `page_kind` value), since duplicated bodies advertise coverage that does not exist.

**Write the missing `validation-contract.md` for this mission (process).** Two consecutive scrutiny passes have had to reconstruct assertion text from feature files because `missions/20260919-150607/validation-contract.md` does not exist. Under repo rule 5 the contract is the immutable source of truth and a validator reconstructing it is free to reconstruct it *wrongly*. Reconstruct and commit the contract from the feature files as they stand, before any further milestone is validated.

## Pre-existing failures (NOT caused by M8)

The full `tests/unit` run shows 9 failing files / 30 failing tests, the **same
set and count as pass 1**: `f027-calendar-realtime-wiring`, `undo-toast`,
`personal-todo-list-realtime-wiring`, `f022-board-realtime-guard-call-site`,
`f251-list-table-realtime`, `f042-no-approval-lock-comments`,
`f019-my-tasks-realtime-hook-set-identity`, `f039-portal-guards`,
`watching-feed-query`. All are in domains M8 never touched. No M8 file is
among them.

The archived run below reports **10** files / 31 tests, including
`f010-create-page-action.test.ts (1 failed)`. That tenth failure is an
artifact: a parallel review subagent was mid-mutation on
`lib/actions/architecture/pages.ts` while the full suite ran. Re-running the
five M8-owned files against the restored tree gives **19/19 passed**
(`f010`, `f045`, `f046`, `f048`, `m8-reorder-components`). M8 is clean.

AS-006's "test suite passes" leg has now been red for several milestones on
this unchanged baseline. The orchestrator should decide explicitly whether
that is an accepted baseline or a debt item; it is not an M8 defect, but it
cannot keep being carried forward silently.

---

## Appendix — full command output

### `npx tsc --noEmit` → exit **0** (no output)

### `npm run lint` → exit 0 (7 warnings, 0 errors; none in M8 files)
```

> pm-app@0.1.0 lint
> eslint


/Users/sasajapranin/Desktop/pm-app/components/code-editor/editor-pane.tsx
  152:5  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/scripts/check-cron-health.mjs
  159:9  warning  'cutoffIso' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-completion-providers.test.ts
  323:21  warning  'registered' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-editor-lazy.test.tsx
  13:61  warning  'opts' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-link-interception.test.tsx
  34:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-monaco-editor.test.tsx
  157:7  warning  'configureMonacoCalledBeforeFirstMount' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-origin-guard.test.ts
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 7 problems (0 errors, 7 warnings)
  0 errors and 3 warnings potentially fixable with the `--fix` option.

```

### `npx vitest run tests/unit` → exit 1 (see artifact note above)
```
 ❯ tests/unit/f010-create-page-action.test.ts (5 tests | 1 failed) 112ms
 ❯ tests/unit/undo-toast.test.tsx (3 tests | 1 failed) 977ms
 ❯ tests/unit/f027-calendar-realtime-wiring.test.tsx (7 tests | 7 failed) 78ms
 ❯ tests/unit/personal-todo-list-realtime-wiring.test.tsx (7 tests | 7 failed) 53ms
 ❯ tests/unit/f022-board-realtime-guard-call-site.test.tsx (5 tests | 5 failed) 156ms
 ❯ tests/unit/f042-no-approval-lock-comments.test.ts (3 tests | 1 failed) 6ms
 ❯ tests/unit/f251-list-table-realtime.test.tsx (3 tests | 2 failed) 129ms
 ❯ tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx (2 tests | 2 failed) 12ms
 ❯ tests/unit/f039-portal-guards.test.ts (4 tests | 3 failed) 10ms
 ❯ tests/unit/watching-feed-query.test.ts (2 tests | 2 failed) 4ms
 Test Files  10 failed | 491 passed | 1 skipped (502)
      Tests  31 failed | 3301 passed | 3 skipped (3335)
```

### M8-owned files re-run against the restored tree → exit 0
```
npx vitest run tests/unit/f010-create-page-action.test.ts \
  tests/unit/f046-create-page-schema-page-kind-optional.test.ts \
  tests/unit/f045-create-page-dialog-page-kind.test.tsx \
  tests/unit/m8-reorder-components.test.ts \
  tests/unit/f048-component-panel-dnd.test.tsx

 Test Files  5 passed (5)
      Tests  19 passed (19)
```

### Mutation log
```
SortableContext -> bare fragment (component-panel.tsx)   => f048 1 failed / 3 passed   [AS-162 falsifiable]
upsert rows built from DB order instead of submitted     => m8   1 failed / 4 passed   [AS-161 falsifiable]
drop `if (!result.success)` guard (always refresh)       => f048 1 failed / 3 passed   [AS-164 falsifiable]
delete `<PageKindSelector>`                              => f045 3 failed             [AS-152]
initial pageKind state "static" -> "cms"                 => f045 1 failed / 2 passed  [AS-153]
submit `page_kind: pageKind` -> hardcoded "static"       => f045 1 failed / 2 passed  [AS-154]
drop page_kind from tasks insert (pages.ts)              => f010 1 failed / 4 passed  [AS-155]
override page_kind to "cms" in tasks insert              => f010 1 failed / 4 passed  [AS-155]
pageKindEnum.default("static") -> required               => 3 failed                  [AS-156]
pageKindEnum.default("static") -> .default("cms")        => 3 failed                  [AS-156]
delete `.refine` uniqueness from reorderComponentsSchema => m8   5 PASSED  *** test does not pin the new guard (minor)
probe: 2-component project sent [A, A, B]                => action returns success:false, 0 upserts  [AS-160 hole closed]
```
