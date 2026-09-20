# M8 Scrutiny — pass 1 — **RED**

_Date: 2026-09-20 · Features F045, F046, F047, F048 · Assertions AS-152…AS-156, AS-159…AS-164 (+ AS-006 gate)_

Note: this mission has no `validation-contract.md` on disk. Assertion text was
reconstructed from `missions/20260919-150607/features/F04*.md`. That is itself a
process defect — the contract is supposed to be the immutable source of truth.

## Verdicts

| ID | Verdict | Reason |
|---|---|---|
| AS-006 | **FAIL** (blocker) | `npx tsc --noEmit` exits 2 with 2 errors, both in M8's own `tests/unit/f048-component-panel-dnd.test.tsx`. The typecheck gate is red *because of this milestone*. |
| AS-152 | PASS | `CreatePageDialog` renders `<PageKindSelector value onChange>`; test asserts the trigger exists and fails if the selector is deleted. |
| AS-153 | PASS (minor) | Default state is `"static"`; test asserts `aria-selected` before interaction and catches a flip to `cms`. Nothing asserts the *submitted* payload on the untouched-default path. |
| AS-154 | PASS | Real state→submit wiring; only the server-action module is mocked. Hardcoding `"static"` fails the test. |
| AS-155 | **FAIL** (blocker) | The test named AS-155 tests the inverse of the assertion: it is schema-only and it *supplies* `page_kind: "cms"`. The `createPage` action is never called without `page_kind` by F046. Worse, `CreatePageInput` is `z.infer` (output type), so `page_kind` is **required** at the type level — a real caller omitting it is a TS error; only runtime tolerates it (the pre-existing f010/AS-031 test has to cast `as never` to compile). |
| AS-156 | PASS (minor) | `.default("static")` makes the field optional and the test fails if `.default` is removed. But it asserts only `result.success` — changing the default to `"cms"` is invisible to this test. |
| AS-159 | PASS | `reorderComponents` exported from `lib/actions/architecture.ts`; test imports through the barrel. |
| AS-160 | **FAIL** (major) | Real set comparison against live `page_components` rows, with RBAC (`requireActiveMembership` + `canWrite`) enforced first — good. But `submittedIds` is a `Set`, so **duplicate ids pass the completeness check**: `[A,A,B]` vs `{A,B}` satisfies size+membership, then writes `A→0, A→1, B→2` concurrently. Position 0 is orphaned and A's final position is nondeterministic. `reorderComponentsSchema` does not enforce uniqueness. Untested. |
| AS-161 | **FAIL** (major) | Two independent defects. (a) The test asserts only the `update()` payloads `{position:0/1/2}` and never the `.eq(id)` argument — writing indices in *DB* order instead of the caller-submitted order would still pass. The test therefore does not prove the assertion's intent. (b) The write is `Promise.all` of N independent updates with no transaction/RPC: a mid-batch failure commits a partial reorder and returns a generic error, leaving duplicate/missing positions with no rollback. |
| AS-162 | **FAIL** (blocker as tested) | The implementation does wrap `SortableContext` in `DndContext`, but the test mocks `@dnd-kit/core`'s `DndContext` to a pass-through and relies on the (false) premise that `useSortable` throws outside a `SortableContext`. `@dnd-kit/sortable` supplies a **default context value**, so deleting `SortableContext` entirely leaves every assertion in this test green. Nothing asserts `SortableContext`, its `items`, or its `strategy`. The assertion is not exercised by any test that could fail. |
| AS-163 | PASS (major caveat) | `handleDragEnd` is genuinely captured from the real render as `DndContext`'s `onDragEnd`, and the `arrayMove` path is exercised. But the drag handle's `{...listeners}` spread, sensor config and sortable wiring are untested — the row could be undraggable in a browser and this test stays green. No E2E drag coverage. |
| AS-164 | PASS (major gap) | `router.refresh()` is called after a successful reorder and the test awaits it. The failure paths are not: `void reorderComponents(...).then(...)` has **no `.catch`**, so a rejected server action is an unhandled rejection and a silent no-op — the row snaps back with no explanation. The `success: false` / `toast.error` branch has no test. No `useTransition`, so a second drag mid-flight recomputes from the stale `components` prop. |

## Severity summary

- **blocker**: AS-006 (tsc red), AS-155 (assertion untested / type-level contradiction), AS-162 (test cannot fail)
- **major**: AS-160 (duplicate-id hole), AS-161 (test does not verify id↔position pairing; non-atomic write), AS-163/AS-164 (untested drag wiring and error paths)
- **minor**: AS-153, AS-156 (partial assertions); orphaned `<Label htmlFor="page-kind">` with no matching id in `create-page-dialog.tsx`; `ComponentPanel`'s `projectId?: string = ""` default weakening a contract whose only call site always supplies it.

## Recommended follow-up features

**Fix the typecheck gate in the F048 test file.** `tests/unit/f048-component-panel-dnd.test.tsx` fails `tsc --noEmit` with TS2556 at line 26 (a spread argument that is neither a tuple nor bound to a rest parameter) and TS2322 at line 65 (a fixture object whose `position` is `number | undefined` assigned to `BoardComponent`, which requires `number`). Type the captured `onDragEnd` invocation with an explicit tuple or a typed `DragEndEvent` argument rather than a spread, and give the fixture a concrete `position`. AS-006 is the gate on every milestone and it is currently red solely because of this milestone's own file; nothing else in M8 should be accepted until `npx tsc --noEmit` exits 0.

**Make AS-155 mean what it says.** Add a test that calls the `createPage` server action with `{ name, slug }` and no `page_kind`, asserting it returns success and that the row written carries `page_kind: "static"` — and resolve the type-level contradiction by making the action's input type `z.input<typeof createPageSchema>` instead of `z.infer`, so that omitting `page_kind` is legal for real callers rather than only tolerated at runtime and cast away with `as never` in tests. Also extend the F046 schema test to assert `result.data.page_kind === "static"` so that flipping the default is caught.

**Make AS-162 falsifiable.** Either stop mocking `@dnd-kit/core`'s `DndContext` in `f048-component-panel-dnd.test.tsx` and mount the real provider, or add explicit assertions on the rendered tree that `SortableContext` is present and receives the component ids as `items` with a vertical strategy. The current test passes with `SortableContext` deleted, because `@dnd-kit/sortable` ships a default context value — so the assertion is presently protected by nothing. Prove the fix by mutation: remove `SortableContext` and show the test goes red.

**Close the duplicate-id hole in `reorderComponents` (AS-160).** Add a uniqueness constraint to `reorderComponentsSchema` (a `.refine` that `new Set(componentIds).size === componentIds.length`) or compare `componentIds.length` against the live row count in addition to the set membership check, so that `[A, A, B]` against a two-component project is rejected rather than issuing conflicting concurrent writes for `A`. Add a test for the duplicate case and for a payload containing an id from another project.

**Harden the AS-161 position write and its test.** Replace the `Promise.all` fan-out of N independent `update().eq(id)` calls with a single atomic write (a Postgres RPC or an upsert of the full ordered set) so a mid-batch failure cannot leave the panel in a partially reordered state, and add a defensive `.eq("project_id", projectId)` to the write. Separately, change `m8-reorder-components.test.ts` so the mock records the `(id, position)` tuple rather than the payload alone, and assert the exact pairing — today the test cannot distinguish "positions written in the caller's submitted order" from "positions written in the existing DB order", which is precisely what the assertion is about.

**Give the drag handler an error path and a pending state (AS-163/AS-164).** `handleDragEnd` currently fires `void reorderComponents(...).then(...)` with no `.catch`, so a rejected server action becomes an unhandled promise rejection and the user sees the row snap back silently. Add a `.catch` that surfaces a toast, add a test for the `success: false` branch (asserting the error toast fires and, deliberately, that `router.refresh()` is not called), and wrap the call in `useTransition` so the panel shows a pending state and a second drag cannot be computed from the stale `components` prop mid-flight.

## Pre-existing failures (NOT caused by M8)

The full `tests/unit` run has 9 failing files / 30 failing tests. All are in
domains M8 never touched (realtime wiring, portal guards, watching feed,
undo toast) and the one architecture-adjacent failure —
`f042-no-approval-lock-comments.test.ts` asserting the string `comment` is
absent from `section-card.tsx` — points at a file whose last commit is
`36c06984` (F105, M5-era). `component-panel.tsx` contains zero occurrences of
`comment`. These are **not** M8 regressions, but they do mean AS-006's
"test suite passes" leg has been red for several milestones and is being
carried forward unacknowledged. The orchestrator should decide explicitly
whether that is an accepted baseline or a debt item.

---

## Appendix — full command output

### `npx tsc --noEmit` → exit 2
```
tests/unit/f048-component-panel-dnd.test.tsx(26,68): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
tests/unit/f048-component-panel-dnd.test.tsx(65,3): error TS2322: Type '{ id: string; name: string; position?: number | undefined; instanceCount: number; }' is not assignable to type 'BoardComponent'.
  Types of property 'position' are incompatible.
    Type 'number | undefined' is not assignable to type 'number'.
      Type 'undefined' is not assignable to type 'number'.
```

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

### `npx vitest run tests/unit` → exit 1
```
Test Files  9 failed | 492 passed | 1 skipped (502)
     Tests  30 failed | 3299 passed | 3 skipped (3332)
 ❯ tests/unit/f027-calendar-realtime-wiring.test.tsx (7 tests | 7 failed) 78ms
 ❯ tests/unit/undo-toast.test.tsx (3 tests | 1 failed) 932ms
 ❯ tests/unit/personal-todo-list-realtime-wiring.test.tsx (7 tests | 7 failed) 50ms
 ❯ tests/unit/f022-board-realtime-guard-call-site.test.tsx (5 tests | 5 failed) 155ms
 ❯ tests/unit/f251-list-table-realtime.test.tsx (3 tests | 2 failed) 125ms
 ❯ tests/unit/f042-no-approval-lock-comments.test.ts (3 tests | 1 failed) 7ms
 ❯ tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx (2 tests | 2 failed) 12ms
 ❯ tests/unit/f039-portal-guards.test.ts (4 tests | 3 failed) 10ms
 ❯ tests/unit/watching-feed-query.test.ts (2 tests | 2 failed) 4ms
```
