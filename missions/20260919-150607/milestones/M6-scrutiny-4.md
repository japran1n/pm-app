# M6 — Scrutiny pass 4 (adversarial)

Date: 2026-09-20
HEAD: `26160d64` (F113)
Scope: F037–F040 + fix features F107–F113
Files under review:
- `tests/unit/m6-action-barrel-guard.test.ts`
- `tests/unit/m6-check-value-guard.test.ts`

## Verdict: RED

Both scrutiny-3 blockers are **genuinely closed**, and I verified each one by
falsification rather than by reading the diff:

- **AS-127 is fixed.** A drop-in `findLastCheckConstraintValues` that only calls
  `readdirSync` and returns hardcoded arrays now scores **5/8** — it fails all
  three fixture value tests, because the constraint name and every value literal
  are `randomUUID`-derived at run time and unknowable to a lookup table. The
  scrutiny-3 exploit is dead.
- **AS-130's enumeration gap is fixed.** Every form named in FU-7 now hard-fails:
  multi-line bare `export {\n x,\n};`, `export async function`, `export const`,
  `export *`, `export default`, `export =`, tab-separated `export\t{`, and a bare
  export adjacent to a legitimate from-block (the `[^}]*` removal regex cannot
  swallow it, verified).

RED is called on a single, trivially-fixable but objective failure: **the
milestone's own fix commit introduced the only ESLint *error* in the repository**,
in the file it was fixing.

```
tests/unit/m6-action-barrel-guard.test.ts
  172:7  error  'remainder' is never reassigned. Use 'const' instead  prefer-const
```

`npx eslint . --max-warnings 0` over the whole repo reports **1 error, 7 warnings**
— the single error is this one. `npx eslint <the two guard files> --max-warnings 0`
was clean at scrutiny-3 and now exits 1. The gate command named for this pass fails.
`next build` is unaffected (Next 16 no longer runs ESLint during build), so this is
not a broken build — but `npm run lint` is red, and I will not certify a milestone
whose named gate command exits non-zero. One word, `let` → `const`, closes it.

## Assertion table

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-126 | PASS | — | `tests/unit/m6-check-value-guard.test.ts` imports `pageKindEnum`/`sectionKindEnum` from `@/lib/validation/architecture`, sits under `tests/unit/`, inside the default vitest include, not excluded. Runs in plain `vitest run`. |
| AS-127 | PASS | major (parser gaps, inert) | Fixtures are now generated at run time into `mkdtempSync` dirs with `randomUUID` constraint names and values; a hardcoded-map implementation scores 5/8 (was 8/8). Falsification matrix: readdir-only 5/8, all-literals-from-all-files 3/8, literals-from-last-file-only 6/8, real-parser-minus-throws 5/8. **No mutant reached 8/8 without genuinely locating the constraint and parsing its expression body.** Caveat recorded below: the fixture group alone is still beatable (mutant (c) passes 5/5 fixtures); it is the *combination* with AS-128/129 that is sound. |
| AS-128 | PASS | — | Re-verified by hand over all 279 migrations. Only `20261121010000_f002_page_components.sql` (static/cms/utility) and `20261124010000_architecture_cms_template_and_section_kind.sql` (+`cms_template`) touch `tasks_page_kind_check`. Parser → `['static','cms','cms_template','utility']` = `pageKindEnum`. Drift simulated on a temp copy in both directions (later narrowing; later widening via `= any (array[...])`) — both produce FAIL. |
| AS-129 | PASS | — | Same mechanism. `tasks_section_kind_check` = `['static','cms']` = `SECTION_KINDS`. Set equality *and* length both asserted, so a duplicate-value enum cannot slip through. |
| AS-130 | PASS | major (residual enumeration hole + one false-positive) | The FU-7 blocker is closed: 19 mutated barrels covering every realistic disallowed export form all hard-fail, with no false positive on `}` inside comments, the word `export` inside strings/template literals, backtick specifiers, or `export { type Foo, bar } from "./x"`. Reference resolution remains sound (23 actions, each satisfied by exactly one production consumer, zero slack). Downgraded from blocker to major because the four remaining escapes are exotic identifier forms, not idiomatic code — see finding 1. |
| AS-131 | PASS | — | Divergence fails from either side, verified against a temp copy of the real migrations dir. Every unparseable shape `throw`s rather than falling back; there is no silent-pass path. |
| AS-132 | PASS | major (stale evidence) | Carried unchanged from pass 3. The mutation (drop `"cms"` from `SECTION_KINDS`) is realistic and the recorded FAIL output is concrete, with a clean revert. Still marked fragile: the output captured in `F040-handoff.md` depicts the **pre-F108** test file. FU-10 remains unactioned. |
| AS-133 | PASS | major (fragile) | Carried unchanged. F109's proof (removed call, stale comment left behind) and F110's stronger proof (`createPage` stripped from its sole consumer plus a `tests/helpers/fake-actions.ts` collider) both FAIL correctly. |
| AS-134 | PASS | — | Both guard files grepped in full: no `allowlist`, `@guard-ignore`, `.skip`/`.todo`/`.only`/`skipIf`, no `eslint-disable`, no `@ts-expect-error`, no try/catch. Failures route through `expect.fail` and `expect(...).toEqual([])`. Nothing exempted by name. |
| AS-006 (gate) | INCONCLUSIVE | major, non-blocking | `tsc --noEmit` clean. Full `vitest run`: **263 failed / 591 passed / 2 skipped (856 files)**, **206 failed / 4518 passed / 1696 skipped (6420 tests)** — byte-identical to passes 2 and 3, so M6's fourth pass introduced no test regression. Still unadjudicable against the recorded 262/833 baseline captured under multi-worker contention. Failures remain the pre-existing `supabase.rpc is not a function` / `auth.getSession` class. FU-12 stands. |
| **Lint gate** | **FAIL** | **blocker** | `prefer-const` error at `tests/unit/m6-action-barrel-guard.test.ts:172`, introduced by F113. Sole ESLint error in the repo. |

## Verified findings

All reproduced against mutated **copies** in scratch dirs. No repo file was
modified; `git status` is unchanged from session start.

### 1. Barrel guard — four dead exports still escape (major)

`parseBarrelExports` line 165 (`.filter((s) => /^\w+$/.test(s))`) **silently
discards** any specifier it cannot parse instead of routing it to the
`expect.fail` path that exists exactly for unenumerable constructs. Because the
name is dropped rather than flagged, `EXPECTED_ACTION_COUNT` stays at 23 and the
count backstop never fires. Each of these adds a dead export and leaves the guard
fully GREEN:

1. `export { $zombieAction } from "./architecture/pages";` — `\w` excludes `$`, a legal JS identifier character.
2. `export { createPage as zombie$ } from "./architecture/pages";` — same cause, on the alias side.
3. `export { zombieAction as "zombie" } from "./architecture/pages";` — ES2022 arbitrary module namespace names; `\bas\s+(\w+)$` misses the quoted alias. Verified GREEN even when appended inside the legitimate pages block.
4. `export { zombiéAction } from "./architecture/pages";` — valid identifier, `\w` is ASCII-only.

Graded major, not blocker: none of these forms is idiomatic in this codebase, and
every realistic form is now caught. The fix is one line — fail instead of filter.

### 2. Barrel guard — false RED on an aliased inline type specifier (major)

`export { setNodeMeta, type Foo, type Bar as Baz } from "./architecture/node-meta";`
yields count 24 and a reference FAIL naming `Baz`. The `as` regex grabs `Baz`
without first checking whether the specifier began with `type `. Unaliased
`type Foo` is handled correctly. This is legal, idiomatic TypeScript that would
turn a legitimate barrel red.

### 3. AS-127 — the fixture group alone is still falsifiable (major)

Mutant (c), "return every single-quoted literal in the lexically-last file",
passes **all 5 fixture tests**, because each generated fixture file contains only
the constraint's own literals. It dies on AS-128/129, where the last real
migration contains unrelated literals. The two groups are complementary; neither
is sufficient alone. A fixture whose last file also carries an unrelated
constraint would close this.

### 4. CHECK parser gaps — all inert against today's migrations (major, carried)

Re-confirmed by fixture, and re-confirmed as **not** affecting either real
constraint file:

| Gap | Behaviour | Hits real migrations? |
|---|---|---|
| `not in` | `check (k not in ('bad1','bad2'))` → returns them as the *allowed* set | No |
| SQL comments | a commented-out `-- ... check (k in ('ghost'))` is parsed as live | No |
| add-then-drop in one file | drops scanned before adds, per file → returns the added values instead of throwing | No (both real files order drop-before-add) |
| compound columns | `a in ('x','y') and b in ('p','q')` → `['x','y']`; the value list is never anchored to the constrained column | No |

Minor: `MIGRATIONS_DIR` uses `process.cwd()`, so the real-migration tests are
correct only when vitest runs from the repo root (it does, per `vitest.config.ts`).

### 5. Process note — this mission has no validation contract file (major)

`missions/20260919-150607/` contains no `validation-contract.md`. Assertion texts
for AS-126…AS-134 were read out of the feature files (`features/F037…F040`). Hard
rule 5 ("the validation contract is immutable once APPROVED exists") cannot be
enforced against a file that does not exist, and four scrutiny passes have now
graded against prose in feature specs. Also: `missions/CURRENT` reads
`20260919-131402`, not this mission.

### 6. Carried forward, unactioned

`BoardPageKind` / `BoardSectionKind` are still hand-written unions at
`lib/queries/architecture.ts:31` and `:35`, and `KINDS` is still hand-written in
`components/architecture/page-kind-selector.tsx`. A coordinated migration + Zod
widening passes every M6 guard while neither gains the new member. (FU-4 from
pass 2, FU-11 from pass 3.)

## Recommended follow-up features

**FU-13 (blocker). Restore the lint gate.** Change `let remainder` to
`const remainder` at `tests/unit/m6-action-barrel-guard.test.ts:172`. It is never
reassigned — the two `.replace()` calls are chained into the initializer. Then run
`npx eslint . --max-warnings 0` and confirm the repo reports zero errors (seven
pre-existing warnings in unrelated `tests/unit/th-*` files are out of scope and
should be left alone). This is the only thing standing between M6 and green.

**FU-14 (major). Make `parseBarrelExports` fail on specifiers it cannot parse,
instead of dropping them.** In the `.map`/`.filter` chain, replace the terminal
`.filter((s) => /^\w+$/.test(s))` with logic that: skips a specifier beginning
with `type ` *only when it is a bare `type Foo`*; extracts the alias for
`type Foo as Bar` and skips that too (closing the false-RED in finding 2); and
`expect.fail`s, with the offending specifier quoted, on anything else that does
not match a full JS identifier — explicitly including `$`-bearing names, non-ASCII
identifiers, and ES2022 string-literal aliases (`x as "y"`). Acceptance evidence:
each of the four mutations in finding 1 added to the barrel turns the guard RED,
and `export { setNodeMeta, type Foo, type Bar as Baz } from "./architecture/node-meta";`
leaves it GREEN at count 23.

**FU-15 (major). Strengthen the AS-127 fixtures so the fixture group is
self-sufficient.** Today a "dump every literal in the last file" implementation
passes all five fixtures. Have each generated fixture also write a second,
*unrelated* constraint (its own random name and its own random values) into the
same file as the target constraint — usually the lexically last one — and assert
that none of the decoy values appear in the result. That forces the parser to key
on the constraint name rather than on file position, without depending on the real
migrations dir to do it.

**FU-16 (major). Tighten the CHECK expression parser.** Unchanged from FU-8:
strip `--` and `/* */` comments before any scanning; `throw` on a `not in` list
rather than reading it as an allow-list; resolve drops and adds by character
offset within a file so add-then-drop and drop-then-re-add are both decided by
position; anchor the value list to the constrained column so a compound
`a in (...) and b in (...)` cannot pick the wrong list (or throw when the column
cannot be identified). Add a runtime-generated fixture per case.

**FU-17 (major). Bind the barrel guard's import check to the barrel and carry
aliases through.** Unchanged from FU-9. The specifier test is the substring regex
`/lib\/actions\/architecture/`, which also matches the leaf module
`@/lib/actions/architecture/components`, so importing directly from a leaf still
satisfies a *barrel* export. Also: handle `import x, { y } from …`; carry the
local alias from `import { createPage as cp }` into the call regex so `cp()`
counts; and accept value references (`action={createPage}`,
`useActionState(createPage, …)`), not only call sites.

**FU-18 (major). Write `missions/20260919-150607/validation-contract.md`.** See
finding 5. Transcribe AS-126…AS-134 verbatim from the F037–F040 feature files into
a proper contract file so future passes grade against an immutable artifact, and
fix `missions/CURRENT`.

**FU-19 (major). Re-capture the AS-132 mutation proof against the shipping test
file.** Unchanged from FU-10. `F040-handoff.md`'s AS-132 output depicts the
pre-F108 file. Re-run the `SECTION_KINDS` mutation against the current
`tests/unit/m6-check-value-guard.test.ts`, capture the FAIL output with current
test names and line numbers, and append it, superseding the stale block rather
than deleting it.

**FU-20 (major). Single-source `BoardPageKind` / `BoardSectionKind` off the Zod
enums.** Unchanged from FU-11 / FU-4. Replace the hand-written unions at
`lib/queries/architecture.ts:31` and `:35` with `z.infer<typeof pageKindEnum>` /
`z.infer<typeof sectionKindEnum>`, and the hand-written `KINDS` array in
`components/architecture/page-kind-selector.tsx` with `pageKindEnum.options`,
mirroring `section-kind-selector.tsx`.

**FU-21 (major). Capture a real AS-006 baseline in isolation.** Unchanged from
FU-12 / FU-5. Four passes have now reported 263/856 against an unadjudicable
262/833 figure. Run the full suite with no concurrent worker sessions, record
exact failing-file and failing-test counts plus failure classes, and write that
into `run-log.md` as the authoritative budget.

---

## Command output

### `npx tsc --noEmit 2>&1 | tail -5`
```
(no output — clean, exit 0)
```

### `npx eslint tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --max-warnings 0 2>&1 | tail -5`
```
  172:7  error  'remainder' is never reassigned. Use 'const' instead  prefer-const

✖ 1 problem (1 error, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.
```

### `npx eslint . --max-warnings 0 2>&1 | tail -15` (repo-wide, for context)
```
/Users/sasajapranin/Desktop/pm-app/tests/unit/th-editor-lazy.test.tsx
  13:61  warning  'opts' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-link-interception.test.tsx
  34:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-monaco-editor.test.tsx
  157:7  warning  'configureMonacoCalledBeforeFirstMount' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-origin-guard.test.ts
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 8 problems (1 error, 7 warnings)
  1 error and 3 warnings potentially fixable with the `--fix` option.
```

### `npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: parser reads SQL files — unknown constraint throws even with real migrations 10ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: pageKindEnum matches tasks_page_kind_check 9ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum matches tasks_section_kind_check 9ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: parses IN(...) form from a single file 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: picks latest migration when redefined (widen via IN) 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: parses = ANY (ARRAY[...]) form 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: throws when last mention is a drop (drop without re-add) 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: throws on unknown constraint name against real migrations dir 11ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses the expected number of exported actions from the barrel 1ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 385ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  542ms
```

### `npx vitest run --reporter=dot` (full suite, AS-006 gate)
```
 Test Files  263 failed | 591 passed | 2 skipped (856)
      Tests  206 failed | 4518 passed | 1696 skipped (6420)
   Duration  166.18s
```
Identical to scrutiny passes 2 and 3. Recorded mission baseline (F023/F054/F055):
262 failing files of 833, 210 failing tests — captured under multi-worker
contention, still not adjudicable.

### AS-127 falsification matrix (mutant parsers, scratch copies)
```
(a) readdirSync only, hardcoded arrays keyed on constraint name  -> 3 failed / 5 passed
(b) all single-quoted literals from all files                    -> 5 failed / 3 passed
(c) all literals from the lexically-last file only               -> 2 failed / 6 passed
(d) real parser verbatim, both throws removed                    -> 3 failed / 5 passed
baseline (real parser)                                           -> 0 failed / 8 passed
```
No mutant reached 8/8. Scrutiny-3's exploit (a) went from 8/8 to 5/8.

### AS-130 barrel enumeration mutation matrix (19 mutations, scratch harness)
```
CAUGHT (hard-fail) — multi-line bare export{}; export async function;
  export const; export *; export default; export =; export\t{;
  export {} from "./x" adjacent to bare export {zombie}; bare export before a
  from-block on one line; backtick specifier; declare module {export const};
  export {zombie} after a function body with braces
CAUGHT (count 24 + reference FAIL) — dead name in a legit from-block;
  zombieInternal as zombieAction; createPage as zombieAction;
  multi-line "zombieInternal as\n zombieAction"; zombieAction as default;
  specifier containing "}" inside the module path
NO FALSE POSITIVE — "}" inside // and /* */ comments; the word export inside a
  comment, a string, or a template literal; single-quoted specifiers;
  export { type Foo, bar } from "./x"  (count stays 23)
ESCAPED (still GREEN, count stays 23) — export { $zombieAction };
  export { createPage as zombie$ }; export { zombieAction as "zombie" };
  export { zombiéAction }
FALSE RED — export { setNodeMeta, type Foo, type Bar as Baz } from "./x"
  -> count 24, reference FAIL(Baz)
```
