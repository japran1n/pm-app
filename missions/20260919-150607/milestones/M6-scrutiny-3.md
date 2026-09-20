# M6 — Scrutiny pass 3 (adversarial)

Date: 2026-09-20
Scope: F037, F038, F039, F040 + fix features F107, F108, F109, F110, F111
Files under review:
- `tests/unit/m6-check-value-guard.test.ts`
- `tests/unit/m6-action-barrel-guard.test.ts`
- `tests/fixtures/m6-check-guard/{01_initial,02_widen_in,03_any_form,04_drop}.sql`

## Verdict: RED

The scrutiny-2 **blocker on AS-130 is genuinely closed** — the identifier-collision
exploit no longer works, and every one of the 23 barrel actions is satisfied by
exactly one real production consumer, with zero slack. That is real progress.

But the milestone is not green:

- **AS-127 still fails its own intent.** A `findLastCheckConstraintValues` that
  reads *zero bytes* of SQL still passes all 8 tests, 8/8. Proven empirically,
  not argued. The fixtures are static files, so each fixture case is uniquely
  identified by its *filename set*; a map keyed on `readdirSync()` output
  predicts every expected answer. F111 moved from "vacuous throw test" to
  "fixtures that a hardcoded map passes". The assertion's whole point —
  "prove the parser reads SQL" — is still unproven.
- **AS-130 has a new under-enumeration escape.** F111's barrel hardening is
  applied **per line**, so it only catches single-line offenders. A multi-line
  `export {\n  zombieAction,\n};` or a plain `export async function
  zombieAction() {}` added to the barrel yields **zero names, zero hard-fails,
  and `EXPECTED_ACTION_COUNT` stays 23** — the new action is never checked at
  all. The count check is not a backstop, because these forms contribute no
  names.

## Assertion table

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-126 | PASS | — | `tests/unit/m6-check-value-guard.test.ts` imports `pageKindEnum`/`sectionKindEnum` from `@/lib/validation/architecture`, lives under `tests/unit/`, is in the default vitest include and not in `exclude`. Runs in the plain `vitest run`. |
| AS-127 | **FAIL** | **blocker** | Empirically defeated: a drop-in replacement that only calls `fs.readdirSync` and returns hardcoded arrays keyed on the constraint name (real dir) and on the sorted fixture filename set (temp dirs) passes **8/8** tests. The four fixtures are static repo files, so no test ever forces the parser to read SQL *content*. Also: the fixtures do not cover `not in`, `--`/`/* */` comments, add-then-drop-in-one-file, or compound two-column expressions — all four of which the real parser gets **wrong** (see findings 1–4). |
| AS-128 | PASS | — | Hand-verified: only two migrations touch `tasks_page_kind_check` (`20261121010000` → static/cms/utility, superseded by `20261124010000` → +cms_template). Parser returns `['static','cms','cms_template','utility']`, matching `pageKindEnum`. Drift simulated in a temp copy of the real 279-file dir in both directions (later narrowing migration; later widening with an extra value) — both produce FAIL. `expect(dbValues.length).toBe(zodValues.length)` closes scrutiny-2's duplicate-value gap. |
| AS-129 | PASS | — | Same mechanism; `tasks_section_kind_check` = `['static','cms']` = `sectionKindEnum.options`. |
| AS-130 | **FAIL** | **blocker** | Two independent halves. (a) *Reference detection is now sound* — scrutiny-2's exploit is dead: an unrelated module with `t.createPage()`/`function createPage(){}`, with or without an unrelated architecture import, no longer satisfies the action (verified in memory against the real tree). All 23 actions resolve to exactly one legitimate consumer under `components/architecture/`, with no slack anywhere. (b) *Enumeration is not sound* — the `export *` / `export default` / bare-`export{}` hard-fail runs **per line**, so a multi-line `export {\n  zombieAction,\n};` or an inline `export async function zombieAction() {}` in the barrel is silently invisible: 0 names added, 0 hard-fail, count unchanged at 23. A future dead action added in either form is never guarded. AS-130 says *every* exported action; the guard covers only the subset it happens to enumerate. |
| AS-131 | PASS | — | Divergence fails from either side (Zod add/remove, migration-side later redefinition), verified against a temp copy of the real migrations dir. No silent-pass path: every unparseable shape throws rather than falling back. Set equality **and** length are both asserted. |
| AS-132 | PASS | major (stale evidence) | The mutation (drop `"cms"` from `SECTION_KINDS`) is realistic and the recorded FAIL output is concrete, with `git checkout --` revert and empty `git diff`. Marked fragile because the captured output in `F040-handoff.md` is from the **pre-F108 version** of the test file (test names `AS-126…AS-129` in their old meanings, `tests/unit/m6-check-value-guard.test.ts:106`). The proof was never re-captured against the current file. Logically it still holds — the current assertions compare `Set`+length — but the evidence on file does not depict the code that ships. |
| AS-133 | PASS | major (fragile) | F109's updated proof in `F040-handoff.md` removes import + call of `changeSectionKind`, deliberately leaves `// previously used changeSectionKind here`, and the guard still FAILs naming the action. F110's separate proof is stronger still: `createPage` stripped from its sole consumer *plus* a `tests/helpers/fake-actions.ts` collider — guard FAILs correctly. Both are realistic. Fragile only in that both exercise names with no real collision in-tree; soundness in the collision case rests on my independent probe, not on the handoff. |
| AS-134 | PASS | — | Both guard files grepped in full: no `allowlist`, `@guard-ignore`, `it.skip`/`it.todo`/`.only`/`skipIf`, no `eslint-disable`, no `@ts-expect-error`, no try/catch. Failures route through `expect.fail` and `expect(...).toEqual([])`. Nothing is exempted by name. |
| AS-006 (gate) | INCONCLUSIVE | major | `tsc --noEmit` clean. `eslint --max-warnings 0` on both guard files clean. Both guard files 10/10 pass. Full `vitest run`: **263 failed / 591 passed / 2 skipped (856 files)**, **206 failed / 4518 passed / 1696 skipped (6420 tests)**. Identical file/test failure counts to scrutiny pass 2, so M6's third pass introduced no regression. Still cannot be adjudicated: the recorded mission baseline (262 files / 210 tests, from F023/F054/F055) was captured under acknowledged multi-worker contention and against a 833-file tree. Failures remain the pre-existing `supabase.rpc is not a function` / `auth.getSession` class, not M6 code. |

## Verified findings

Everything below was reproduced by replicating the guards' exact logic against
mutated **in-memory** copies of the real tree. **No repo file was modified**;
`git status` is unchanged from session start.

### CHECK-value guard (`m6-check-value-guard.test.ts`)

1. **`NOT IN` is silently inverted — major.** `check (k not in ('a','b'))`
   returns `['a','b']` as the *allowed* set, because `\bin\s*\(` matches inside
   `not in`. A future exclusion-style constraint would be read backwards and the
   guard would report agreement with a Zod enum that means the opposite.
2. **SQL comments are parsed as live code — major.** A migration containing only
   `-- add constraint c_check check (k in ('a','b','c'))` yields `['a','b','c']`.
   Block comments leak values too: `in ('a' /*, 'removed' */, 'b')` →
   `['a','removed','b']`. Scrutiny-2 recorded this as fail-closed nuisance; it is
   in fact **fail-open** for the definition scan.
3. **Add-then-drop in one file returns the wrong answer — major.** The drop scan
   runs over the whole file *before* the definition loop, so `add …; drop …;`
   within one migration returns the added values instead of throwing. The
   drop-then-re-add shape used by the real migrations works only by accident of
   that ordering, not by offset tracking.
4. **First `in (...)` wins regardless of column — major (latent).**
   `check (other_col in ('x','y') and k in ('a','b'))` → `['x','y']`. The
   constraint name is never tied to the constrained column.
5. Correct behaviours confirmed: uppercase SQL, `is null or … in (…)`, escaped
   quotes (`'it''s'` → `it's`), nested parens, `= any (array[…])`, paren
   balancing that does not cross into following statements, and the
   `comment on constraint … '… ''cms'' …'` line in the real migration (correctly
   not mis-parsed as a definition).

### Action barrel guard (`m6-action-barrel-guard.test.ts`)

6. **Multi-line local export / inline export is unenumerated and unflagged —
   blocker.** See AS-130 above. This is the direct residue of F111 applying the
   hardening line-by-line.
7. **Deep leaf-module import satisfies a barrel export — major.** The specifier
   test is a substring regex `/lib\/actions\/architecture/`, which also matches
   `@/lib/actions/architecture/components`. Rewriting `component-panel.tsx` to
   import `deleteComponent`/`renameComponent` from the leaf module directly
   leaves the guard GREEN even though nothing imports them from the barrel any
   more. (The action is not *dead*, so this is not a blocker — but the barrel
   export is.)
8. **No reachability notion — major.** Deleting the real `createPage` call site
   and adding `lib/__orphan_never_imported.ts` containing only an import + call
   keeps the guard GREEN. "Real reference in production source" is satisfied by
   code nothing can reach.
9. **Aliased named import false-negative — major (false RED).**
   `import { createPage as cp }` then `cp()`: step (a) matches on the local side
   (`split(/\s+as\s+/)[0]`), but step (b) searches for `createPage\s*\(`, which
   is absent. A purely cosmetic rename turns the guard red. The alias binding is
   not carried into the call regex.
10. **Import forms not handled (all fail-closed, i.e. noisy not bypassing):**
    `import x, { y } from …` (the regex demands `{` immediately after `import`),
    dynamic `await import(…)` + `m.createPage()`, re-export chains through a
    second barrel, and an action used as a *value* rather than called
    (`<form action={createPage}>` — verified: not detected).
11. **Minor false-GREEN paths:** `(?<![.\w$])` does not exclude `#`, so
    `this.#createPage(` in a file that also imports the action counts. Step (a)
    runs against string-**kept** content, so an import statement appearing only
    inside a template literal satisfies (a). A locally shadowed call in a nested
    scope counts. Member access across a newline (`obj\n  .createPage()`)
    correctly does **not** leak.
12. `EXPECTED_ACTION_COUNT = 23` is correct today (pages 7 + sections 7 +
    node-details 1 + node-meta 1 + components 6 + estimates 1). Both
    `export type { … }` blocks are correctly excluded, and inline
    `export { a, type B }` specifiers are correctly filtered by `/^\w+$/`.

### Still open from scrutiny pass 2

13. **`BoardPageKind` is still hand-written** — `lib/queries/architecture.ts:31`
    (`export type BoardPageKind = "static" | "cms" | "cms_template" | "utility";`)
    and `:35` (`BoardSectionKind`), plus the hand-written `KINDS` array in
    `components/architecture/page-kind-selector.tsx`. A coordinated
    migration + Zod widening passes every M6 guard while `BoardPageKind` never
    gains the member and the selector never offers it. (FU-4 from pass 2, not
    actioned — it was never assigned a fix feature.)

## Recommended follow-up features

**FU-6 (blocker). Make the CHECK-guard fixtures runtime-generated so no
hardcoded map can pass.** Replace the four static files in
`tests/fixtures/m6-check-guard/` with a helper that *writes* migration SQL into
a fresh `mkdtemp` directory at test time, using randomized constraint names and
randomized value literals (e.g. `v_${crypto.randomUUID().slice(0,8)}`), and
asserts that exactly those generated values come back. Because neither the
constraint name nor the filename set nor the values are knowable ahead of the
run, an implementation that does not read file *content* cannot pass. Keep the
existing real-migrations assertions (AS-128/AS-129) untouched. The acceptance
evidence must be the same falsification I ran here, inverted: drop in a
`findLastCheckConstraintValues` that only calls `readdirSync` and show the suite
now goes RED.

**FU-7 (blocker). Make the barrel parser hard-fail on the whole source, not
per line.** Run the structural classification over the entire
comment/string-stripped barrel source (not `split("\n")`), and `expect.fail` on
any occurrence of the `export` keyword that is not either an enumerated
`export { … } from "…"` or an `export type { … } …` form — explicitly including
multi-line `export {\n x,\n};` with no `from`, `export async function`,
`export const`, `export class`, `export *`, and `export default`. Acceptance
evidence: a mutation proof adding `export async function zombieAction() {}` to
`lib/actions/architecture.ts` and showing the guard FAILs (today it stays
green), plus the same for a multi-line no-`from` export block.

**FU-8 (major). Tighten the CHECK expression parser and cover it with
fixtures.** Strip SQL `--` line comments and `/* */` block comments before any
scanning; `throw` on a `not in` list rather than reading it as an allow-list;
track drop and add occurrences by character offset within a file so
add-then-drop and drop-then-re-add are both resolved by position, not by a
file-level flag; and anchor the value list to the constrained column name so a
compound `a in (...) and b in (...)` expression cannot pick the wrong list (or
throw when the column cannot be identified). Add runtime-generated fixtures for
each of those four cases.

**FU-9 (major). Bind the barrel guard's import check to the barrel and carry
aliases through.** Normalize the import specifier and require it to resolve to
`lib/actions/architecture` exactly (not a leaf module) when judging whether a
barrel *export* is live; handle `import x, { y } from …`, and carry the local
alias from `import { createPage as cp }` into the call regex so `cp()` counts.
Also accept value references (`action={createPage}`, `useActionState(createPage,
…)`), not only call sites, so the guard stops failing closed on legitimate
Server-Action usage patterns.

**FU-10 (major). Re-capture the AS-132 mutation proof against the shipping test
file.** `F040-handoff.md`'s AS-132 output depicts the pre-F108 test file. Re-run
the `SECTION_KINDS` mutation against the current
`tests/unit/m6-check-value-guard.test.ts`, capture the FAIL output with the
current test names and line numbers, and append it to the handoff, superseding
the stale block rather than deleting it.

**FU-11 (major). Single-source `BoardPageKind` / `BoardSectionKind` off the Zod
enums.** Carried forward unchanged from scrutiny pass 2's FU-4: replace the
hand-written unions at `lib/queries/architecture.ts:31` and `:35` with
`z.infer<typeof pageKindEnum>` / `z.infer<typeof sectionKindEnum>`, and the
hand-written `KINDS` array in `components/architecture/page-kind-selector.tsx`
with `pageKindEnum.options`, mirroring how `section-kind-selector.tsx` already
does it.

**FU-12 (major). Capture a real AS-006 baseline in isolation.** Carried forward
from pass 2's FU-5. Run the full `vitest` suite with no concurrent worker
sessions, record exact failing-file and failing-test counts plus failure
classes, and write that into `run-log.md` as the authoritative budget. Three
scrutiny passes have now reported 263/856 against an unadjudicable 262/833
figure.

---

## Command output

### `npx tsc --noEmit 2>&1 | tail -5`
```
(no output — clean, exit 0)
```

### `npx eslint tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --max-warnings 0 2>&1 | tail -5`
```
(no output — clean)
```

### `npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: parser reads SQL files — unknown constraint throws even with real migrations 11ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: pageKindEnum matches tasks_page_kind_check 9ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum matches tasks_section_kind_check 9ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures > AS-127: parses IN(...) form from a single migration file 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures > AS-127: picks the latest migration's IN(...) redefinition (widen) 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures > AS-127: parses = ANY (ARRAY[...]) form, picks latest migration 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures > AS-127: throws when the constraint was dropped without a later re-add 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures > AS-127: throws on unknown constraint name against the real migrations dir 7ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses the expected number of exported actions from the barrel 1ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 362ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  517ms
```

### `npx vitest run --reporter=dot` (full suite, AS-006 gate)
```
 FAIL  tests/unit/watching-feed-query.test.ts
TypeError: supabase.rpc is not a function
 ❯ tests/unit/watching-feed-query.test.ts:111:19

 Test Files  263 failed | 591 passed | 2 skipped (856)
      Tests  206 failed | 4518 passed | 1696 skipped (6420)
   Duration  167.39s
```
Recorded mission baseline for comparison (F023 / F054 / F055 handoffs):
262 failing test files of 833, 210 failing tests. Pass-2 measurement: 263
failing files of 856, 206 failing tests — identical to this pass.

### AS-130 reference-resolution probe (independent, in-memory)
Each of the 23 barrel actions, and the single production file that satisfies it:
```
createPage                   components/architecture/create-page-dialog.tsx
changePageKind               components/architecture/page-kind-selector.tsx
renamePage                   components/architecture/page-column-header.tsx
deletePage                   components/architecture/delete-page-button.tsx
reorderPages                 components/architecture/board.tsx
setPageClientVisibility      components/architecture/page-client-visibility-toggle.tsx
importPages                  components/architecture/sitemap-io-dialog.tsx
createSection                components/architecture/add-section-button.tsx
deleteSection                components/architecture/delete-section-button.tsx
renameSection                components/architecture/section-card.tsx
reorderSections              components/architecture/board.tsx
moveSectionToPage            components/architecture/board.tsx
setSectionClientVisibility   components/architecture/section-client-visibility-toggle.tsx
changeSectionKind            components/architecture/section-card-menu.tsx
getNodeDetailsForToggle      components/architecture/architecture-view-toggle.tsx
setNodeMeta                  components/architecture/node-meta-dialog.tsx
createComponentFromSection   components/architecture/section-card-menu.tsx
createComponent              components/architecture/component-picker.tsx
linkComponentToSection       components/architecture/component-picker.tsx
renameComponent              components/architecture/component-panel.tsx
unlinkComponentFromSection   components/architecture/section-card-menu.tsx
deleteComponent              components/architecture/component-panel.tsx
setDisciplineEstimatesBulk   components/architecture/discipline-estimate-popover.tsx
TOTAL 23 actions, 910 files scanned, every action satisfied by exactly 1 file
```

### AS-130 mutation probes (in-memory, scrutiny-2 exploit replay)
```
A  collider module, no architecture import       -> referenced? false  (expected false — exploit CLOSED)
B  collider + unrelated architecture import      -> referenced? false  (expected false — CLOSED)
C  stale comment mentioning the action only      -> referenced? false  (expected false)
D  import + method-signature/typeof only, never called -> referenced? TRUE  (false-positive, minor)
E  imported and passed as a value, not called    -> referenced? false  (fails closed — noise)
F  no reachability analysis: an orphan module satisfies the guard
```
