# M6 — Scrutiny pass 2 (adversarial)

Date: 2026-09-20
Scope: F037, F038, F039, F040 + fix features F107, F108, F109
Files under review:
- `tests/unit/m6-check-value-guard.test.ts`
- `tests/unit/m6-action-barrel-guard.test.ts`

## Verdict: RED

One blocker remains (AS-130), one major regression of intent (AS-127), and the
AS-006 gate is not cleanly demonstrable.

## Assertion table

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-126 | PASS | — | Guard file exists, imports `pageKindEnum`/`sectionKindEnum` from `@/lib/validation/architecture`, and is inside the default vitest include set (not excluded by `vitest.config.ts`). |
| AS-127 | FAIL | major | The parser *is* genuinely filesystem-based (no value literals in the test file; verified by re-running the parser body against `supabase/migrations`), but the test **named** AS-127 (`parser throws on unknown constraint name`) is vacuous: a hardcoded `Record<string,string[]>` with a throw-on-miss would pass it byte-for-byte, and would also pass AS-128/AS-129. No test distinguishes "parsed from SQL" from "hardcoded". F108 replaced one vacuous test with another. |
| AS-128 | PASS | — | Resolves `tasks_page_kind_check` to its last-applied definition (`20261124010000`, superseding the narrower `20261121010000`) and compares as sets against `pageKindEnum.options`. Verified drift in both directions fails: enum-side addition and a synthetic later migration narrowing the constraint both produce FAIL. |
| AS-129 | PASS | — | Same mechanism for `tasks_section_kind_check` / `sectionKindEnum` (`static`, `cms`). |
| AS-130 | **FAIL** | **blocker** | An architecture action can be genuinely dead while the guard stays green. `hasRealReference` returns `true` on the *call-site* branch (`\bNAME\s*\(`) before ever looking at imports, and the branch is evaluated with `.some()` across all files — so the call and the import need not be in the same file or bear any relation. `\b` matches after a dot, so `t.createPage()` or `this.createPage()` in *any* unrelated module satisfies the action. Verified: with every occurrence of `createPage` removed from `components/architecture/create-page-dialog.tsx`, a one-line unrelated module `export const t = { createPage() {} }; t.createPage();` keeps the guard green. F107 fixed the comment-stripping half of the original defect but left the identifier-collision half wide open. |
| AS-131 | PASS | — | Divergence fails from either side: Zod-side add/remove, migration-side re-add with different values (chronological last-wins confirmed), and the `= any (array[...])` rendering are all parsed and all produce FAIL. Caveat: the comparison is `Set` vs `Set`, so duplicate-value drift in the SQL list is invisible (the sibling `tests/unit/f053-section-kind-drift.test.ts:35` does assert length; this file does not). Minor. |
| AS-132 | PASS | — | F040 handoff carries the full FAIL output for the CHECK guard after dropping `"cms"` from `SECTION_KINDS`, with the diff, the `git checkout --` revert, and an empty `git diff` confirmation. Independently reproducible. |
| AS-133 | PASS | major (fragile) | F109's updated proof in `F040-handoff.md` now demonstrates the stale-comment case: import + call of `changeSectionKind` removed, the comment `// previously used changeSectionKind here` deliberately left, guard still FAILs naming `changeSectionKind`. That closes scrutiny-1's finding. It is marked fragile because the proof exercises a *name that has no collision anywhere else*; it does not and cannot demonstrate soundness of the guard in the AS-130 collision case above. |
| AS-134 | PASS | — | No `@guard-ignore`, allowlist array, `it.skip`/`it.todo`, `eslint-disable`, or try/catch swallow in either guard. The only `continue` statements are parser branches, not exemptions. Nothing is exempted by name. |
| AS-006 (gate) | INCONCLUSIVE | major | `tsc --noEmit` clean; `eslint` on both guard files clean; both guard files 5/5 pass. Full `vitest run`: **263 failed / 591 passed / 2 skipped (856 files)**, 206 tests failed. The recorded mission baseline is 262 failing files / 210 failing tests (F023, F054, F055 handoffs), so the file count is +1 over budget while the failing-test count is −4 and total files grew 833 → 856. Failures are the known pre-existing `supabase.rpc is not a function` / `getSession` class, not M6 code. Cannot be declared green against a baseline that was itself never captured in isolation. |

## Secondary findings (not blocking, but real)

1. **Barrel parser blind spots** (`m6-action-barrel-guard.test.ts`). `parseBarrelExports` requires `}` followed by `from`. A future action added as `import { newAction } from "./architecture/pages"; export { newAction };` yields zero names — the action is never guarded at all, and `EXPECTED_ACTION_COUNT` stays 23 so nothing complains. `EXPECTED_ACTION_COUNT = 23` is itself correct today (7 pages + 7 sections + 1 node-details + 1 node-meta + 6 components + 1 estimates).
2. **Barrel parser runs on raw source.** `stripCommentsAndStrings` is used only for the `export *` probe. A commented-out `// export { ghostAction } from "./architecture/pages";` is parsed as a live action. Fails loudly, so noise rather than bypass.
3. **Dead `precedingText` / `/type\s*$/` branch.** `export type { Foo } from "x"` never matches `export\s*\{` in the first place, so the skip branch can never do its stated job — but it *can* misfire: any line ending in the word `type` (including a comment) immediately above a real export block silently deletes that block from the guard's list.
4. **`collectFiles(ROOT)` scopes too widely.** 1862 `.ts/.tsx` walked, 957 candidates. It pulls in `extension/` (excluded from `tsconfig.json` entirely), `missions/` scratch (`missions/20260919-150607/milestones/M5-ux-evidence/pw.config.ts`), and 8 non-`.test`-named files under `tests/` (`tests/helpers/*.ts`, `tests/setup/testing-library.ts`, `tests/integration/support/live-db.ts`). A mock or fixture in `tests/helpers/` referencing an action counts as a production reference — exactly what AS-130 forbids.
5. **`pageKindEnum` is not single-sourced.** `lib/queries/architecture.ts:31` hand-writes `export type BoardPageKind = "static" | "cms" | "cms_template" | "utility";` and `components/architecture/page-kind-selector.tsx:15` hand-writes the matching `KINDS` array. Widen the migration *and* `pageKindEnum` together and this guard stays green while `BoardPageKind` never gains the member and the selector silently never offers it. The section side is already correct (`sectionKindEnum.options` is read directly by `section-kind-selector.tsx:18`).
6. **CHECK parser fails-open on add-then-drop-in-one-file.** Within a single migration the drop-scan runs before the def-scan, so the current `20261121010000_f002_page_components.sql:88-90` drop+re-add resolves correctly. The mirror case — add early, drop later in the same file — is misread as still-defined (verified: returns the added values instead of throwing). Not present in history; a future footgun that fails open.
7. **CHECK parser does not strip SQL `--` comments for the drop-scan.** A `--`-commented mention of `drop constraint tasks_page_kind_check` makes the parser throw "dropped without a later re-add". Fails closed, so nuisance only.
8. **Compound CHECK bodies** are handled only by ordering luck — the parser takes the first `in ( … )` in the expression. A future `check ((section_kind in (...)) and (page_kind in (...)))` grabs the wrong list, though it would fail loudly.

## Recommended follow-up features

**FU-1 (blocker — must land before M6 can go GREEN). Bind the barrel guard's call-site branch to an import.** Rework `hasRealReference` in `tests/unit/m6-action-barrel-guard.test.ts` so a bare `NAME(` no longer satisfies an action on its own. An action counts as referenced only when a single file both (a) imports it by name from a specifier resolving to the architecture actions barrel or one of its leaf modules — or namespace-imports that module — and (b) contains a call or value reference to that imported binding. Tighten the call regex to `(?<![.\w$])NAME\s*\(` so member access on an unrelated object cannot satisfy it, unless the object is the namespace binding from a verified architecture import. The acceptance evidence must be a mutation proof of exactly the exploit found here: strip every occurrence of one action from its sole real consumer, add an unrelated module defining a same-named method and calling it, and show the guard still FAILs naming that action.

**FU-2 (major). Make the CHECK-value guard prove it parses, with a fixture.** Add a fixture directory under `tests/fixtures/` containing synthetic migration SQL whose CHECK values are deliberately different from anything in the real schema, parameterise `findLastCheckConstraintValues` on its migrations directory, and assert the exact returned array for: a plain `in (...)` list, an `= any (array[...])` list, a later migration superseding an earlier one, a drop-without-re-add (must throw), and an unparseable compound expression (must throw). Delete the current `AS-127: parser throws on unknown constraint name` test, which a hardcoded map would pass. Also assert list length, not just set equality, so duplicate-value drift in SQL is caught.

**FU-3 (major). Harden the barrel export parser and narrow its scan scope.** Run `parseBarrelExports` on comment-stripped source; make the parser `expect.fail` on any `export` statement in the barrel it cannot classify (the `export { x };` no-`from` form, `export default`, `export *`) rather than silently yielding nothing; delete the dead `precedingText` / `/type\s*$/` branch that can only produce wrong results. Restrict `collectFiles` to the app's real source roots (`app/`, `components/`, `lib/`) instead of the whole repo, so `extension/`, `missions/`, `scripts/`, and all of `tests/` (not merely `*.test.ts`-named files) are out of scope.

**FU-4 (major). Single-source `BoardPageKind` off `pageKindEnum`.** Replace the hand-written union at `lib/queries/architecture.ts:31` with `z.infer<typeof pageKindEnum>` and the hand-written array at `components/architecture/page-kind-selector.tsx:15` with `pageKindEnum.options`, mirroring how the section side already works. Without this, a coordinated migration+Zod widening passes every M6 guard while the UI silently never offers the new kind.

**FU-5 (major). Capture a real AS-006 baseline in isolation.** Run the full `vitest` suite with no concurrent worker sessions on the machine, record the exact failing-file and failing-test counts plus the failure classes, and write that number into `run-log.md` as the authoritative budget. The current 262 figure was recorded during acknowledged multi-worker contention, so the present 263/856 result cannot be adjudicated either way.

---

## Command output

### `npx tsc --noEmit 2>&1 | tail -5`
```
(no output — clean)
```

### `npx eslint tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --max-warnings 0 2>&1 | tail -10`
```
(no output — clean)
```

### `npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: parser throws on unknown constraint name (proves filesystem read) 11ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: pageKindEnum matches tasks_page_kind_check 9ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum matches tasks_section_kind_check 9ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses the expected number of exported actions from the barrel 1ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 79ms

 Test Files  2 passed (2)
      Tests  5 passed (5)
   Duration  229ms
```

### `npx vitest run --reporter=dot` (full suite, AS-006 gate)
```
 FAIL  tests/unit/watching-feed-query.test.ts > getWatchedTasksForUser (query layer) > assembles taskKey from the embedded project's key + the task's number
TypeError: supabase.rpc is not a function
 ❯ Module.getWatchedTasksForUser lib/queries/watching.ts:112:6
 ❯ tests/unit/watching-feed-query.test.ts:111:19

 Test Files  263 failed | 591 passed | 2 skipped (856)
      Tests  206 failed | 4513 passed | 1696 skipped (6415)
   Duration  166.40s
```
Recorded mission baseline for comparison (F023 / F054 / F055 handoffs): 262 failing test files of 833, 210 failing tests.
