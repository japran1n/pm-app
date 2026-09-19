# Handoff: F040 — Manual proof guards catch (AS-132, AS-133)

## Status
COMPLETE

## Assertions covered
AS-132: PASS — CHECK-value guard (`tests/unit/m6-check-value-guard.test.ts`, assertion AS-128 inside it) failed loudly when `sectionKindEnum` was manually mutated to drop `'cms'`, with a clear diff showing the missing value. Full FAIL output captured below, code reverted, `git diff` empty, and the guard test now passes clean.
AS-133: PASS — Action barrel guard (`tests/unit/m6-action-barrel-guard.test.ts`, AS-130) failed loudly when the sole real UI usage of `changeSectionKind` was removed from `components/architecture/section-card-menu.tsx`, correctly listing `changeSectionKind` as an action with no reference outside the barrel/leaf/test files. Full FAIL output captured below, code reverted, `git diff` empty, and the guard test now passes clean.

## Files changed
(none — all mutations were temporary and reverted before commit; only this handoff file is committed)

## Commands run
`npx vitest run tests/unit/m6-check-value-guard.test.ts --reporter=verbose` (1, mutated state — expected fail)
`git checkout -- lib/validation/architecture.ts` (0)
`git diff lib/validation/architecture.ts` (0, empty)
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (1, mutated state — expected fail)
`git checkout -- components/architecture/section-card-menu.tsx` (0)
`git diff components/architecture/section-card-menu.tsx` (0, empty)
`npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, both files pass on clean HEAD)

## Decisions made
- For AS-132's mutation, the spec's example (`pageKindEnum` losing `'cms_template'`) was adjusted to a slightly different but equally realistic scenario: dropping `'cms'` from `SECTION_KINDS`/`sectionKindEnum` (the sibling enum in the same file, guarded by AS-128/AS-129 in the same test file). This is the more realistic version of the exact story in the spec ("developer changed a DB CHECK, forgot to update the mirrored Zod enum") since `tasks_section_kind_check` only has two values (`'static'`, `'cms'`), making a single-value removal the cleanest, smallest possible realistic diff. Both enums live in `lib/validation/architecture.ts` and are covered by the same guard test file, so this satisfies "pick the file `lib/validation/architecture.ts`" from the spec while using the smaller, more surgical mutation.
- For AS-133, the spec allows either "remove import, keep usage" or "remove usage, keep import." Neither alone triggers the barrel guard, because the guard does a **textual** (not type-checked) `\bidentifier\b` scan across the whole repo (excluding barrel, leaf modules, and test files) — a call site with the bare identifier text still present would still count as "used" even if unresolvable at compile time. To produce a real, guard-triggering "dead action" scenario (mirroring what an eslint `no-unused-vars`/refactor tool might leave behind, or what happens after a completed removal), the import line and every textual occurrence of `changeSectionKind` in `components/architecture/section-card-menu.tsx` were removed (call site replaced with an inline type-cast stub so the file still parses), leaving zero references to the identifier outside the barrel/leaf/tests. This is the change that actually exercises the guard's failure path, which is the point of this feature (demonstrate the guard catches drift, not just that a partial/inert edit was made).
- Confirmed via `git diff <file>` (empty output) after each `git checkout --` that no trace of either mutation survived.

## Out-of-scope work needed
(none)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `sectionKindEnum`/`SECTION_KINDS` (dropping `'cms'`) instead of the spec's literal example of `pageKindEnum` losing `'cms_template'`, because it is a smaller, equally realistic "forgot to sync the DB CHECK and the Zod enum" mistake in the same file (`lib/validation/architecture.ts`) and is covered by the same guard test (`tests/unit/m6-check-value-guard.test.ts`, AS-128). The assertion text (AS-132: "guard for CHECK catching is demonstrated") does not name a specific enum, so this satisfies the assertion while being the cleaner of the two available real mutations in that file.
AUTONOMOUS_DECISION: For AS-133, since the barrel guard is a textual repo-wide scan (not TypeScript resolution), removing only the import line (per the spec's first suggested variant) does not trigger a failure — the identifier text at the call site is still "seen" as a reference. Applied the spec's own fallback ("pick whichever is cleaner to demonstrate") by removing all textual occurrences of `changeSectionKind` (import + call, replacing the call with a type-cast stub so the file still parses), which is the mutation that actually exercises and fails the guard, in keeping with the feature's purpose of proving the guard catches real drift.

## Notes for the next worker
- No MCP tools used — this feature is pure local test-guard verification, no external service state involved.
- The CHECK-value guard test file (`tests/unit/m6-check-value-guard.test.ts`) parses `supabase/migrations/*.sql` for the last `add constraint ... check (... in (...))` clause per constraint name and diffs it against the corresponding Zod enum options — mutating either side of that pairing (DB migration text or Zod enum) will trigger a failure; this run mutated the Zod side (`SECTION_KINDS`) since editing migration files is out of scope for this feature.
- The action barrel guard test (`tests/unit/m6-action-barrel-guard.test.ts`) does a project-wide plain-text regex scan for each barrel-exported action name (`\bidentifier\b`), excluding `lib/actions/architecture.ts` itself, everything under `lib/actions/architecture/`, and any `*.test.ts`/`*.spec.ts(x)` file. A dead/removed action only fails this guard when literally zero textual mentions remain outside those exclusions — comments mentioning the identifier by name also count as a "usage" for this guard's purposes, so a full, clean removal (not just deleting an import) is required to observe the FAIL path.

## Mutation proof 1 — CHECK guard (AS-132)
File mutated: `lib/validation/architecture.ts`
Change: `export const SECTION_KINDS = ["static", "cms"] as const;` → `export const SECTION_KINDS = ["static"] as const;` (removed `"cms"`, simulating a developer narrowing the Zod enum, or equivalently forgetting to add a DB CHECK value that Zod still expects — the guard is symmetric and catches drift in either direction).

vitest output:
```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-126: tasks_page_kind_check DB values match pageKindEnum exactly 10ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: pageKindEnum has no extra values beyond the DB CHECK constraint 7ms
 × tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: tasks_section_kind_check DB values match sectionKindEnum exactly 9ms
   → expected Set{ 'static' } to deeply equal Set{ 'static', 'cms' }
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum has no extra values beyond the DB CHECK constraint 7ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: tasks_section_kind_check DB values match sectionKindEnum exactly
AssertionError: expected Set{ 'static' } to deeply equal Set{ 'static', 'cms' }

- Expected
+ Received

  Set {
-   "cms",
    "static",
  }

 ❯ tests/unit/m6-check-value-guard.test.ts:106:32
    104|     const zodValues = sectionKindEnum.options;
    105|
    106|     expect(new Set(zodValues)).toEqual(new Set(dbValues));
       |                                ^
    107|   });
    108|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```
Revert confirmed: `git checkout -- lib/validation/architecture.ts` then `git diff lib/validation/architecture.ts` = (empty)

## Mutation proof 2 — Action barrel guard (AS-133)
File mutated: `components/architecture/section-card-menu.tsx`
Change: Removed `changeSectionKind` from the `@/lib/actions/architecture` import list, and removed the only remaining textual mention of it (the call site and the comment referencing it), replacing the call with an inline type-cast stub so the file still parses. This simulates a refactor/removal that left `changeSectionKind` with no real UI caller anywhere outside the barrel/leaf modules/tests.

vitest output:
```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses at least one exported action from the barrel 1ms
 × tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one reference outside the barrel, leaf modules, and tests 53ms
   → The following architecture action(s) exported from lib/actions/architecture.ts have no reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: changeSectionKind: expected [ 'changeSectionKind' ] to deeply equal []

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one reference outside the barrel, leaf modules, and tests
AssertionError: The following architecture action(s) exported from lib/actions/architecture.ts have no reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: changeSectionKind: expected [ 'changeSectionKind' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "changeSectionKind",
+ ]

 ❯ tests/unit/m6-action-barrel-guard.test.ts:92:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```
Revert confirmed: `git checkout -- components/architecture/section-card-menu.tsx` then `git diff components/architecture/section-card-menu.tsx` = (empty)

## Final green run
```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses at least one exported action from the barrel 1ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one reference outside the barrel, leaf modules, and tests 53ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-126: tasks_page_kind_check DB values match pageKindEnum exactly 14ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: pageKindEnum has no extra values beyond the DB CHECK constraint 6ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: tasks_section_kind_check DB values match sectionKindEnum exactly 7ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum has no extra values beyond the DB CHECK constraint 6ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
```
