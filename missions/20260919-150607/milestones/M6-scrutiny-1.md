# M6 — Scrutiny round 1

Mission: 20260919-150607 · Milestone: M6 (F037–F040) · Date: 2026-09-20
Reviewer: scrutiny-validator (adversarial, read-only). No repo file modified.

## Verdict: **RED**

Both guards pass today, but the action-barrel guard does not enforce the
property AS-130 states, and the CHECK parser has two silent false-green
paths in exactly the drift direction the feature exists to catch. Two
blockers, three majors.

## Assertion table

| ID | Status | Sev | Reason |
|---|---|---|---|
| AS-126 | PASS | — | `tests/unit/m6-check-value-guard.test.ts:5` imports the real `pageKindEnum`/`sectionKindEnum` from `@/lib/validation/architecture` and reads `.options` (not a copy). |
| AS-127 | FAIL | major | Parsing itself is genuine (`fs.readFileSync` over `supabase/migrations/*.sql`, zero hardcoded enum literals). But the `it("AS-127")` block is a **subset** check that is mathematically implied by the Set-equality in the block above it — it cannot fail independently. Vacuous test; assertion has no falsifiable dedicated coverage. |
| AS-128 | FAIL | major | Covered (by the block mislabelled `AS-126`) and it does go RED on Zod-side drift. But the parser regex `add\s+constraint\s+<name>\b[\s\S]*?\bin\s*\(` is unbounded — it can cross the statement terminator and read an unrelated `in (...)` list; and `= ANY (ARRAY[...])`, inline `create table ... constraint X check (...)`, and drop-without-re-add all produce **no match and no throw**, silently falling back to a stale older migration and passing green. See findings 3/4. |
| AS-129 | FAIL | major | Same parser defects as AS-128. Additionally the `it("AS-129")` block is the same vacuous subset pattern as AS-127. |
| AS-130 | **FAIL** | **blocker** | The guard counts a bare `\bName\b` text match anywhere in any `.ts/.tsx` file as "a reference" — **including inside comments and strings**. A live false positive already exists: `changePageKind` is mentioned only in a comment at `lib/validation/architecture.ts:63`, so deleting its sole real call site (`components/architecture/page-kind-selector.tsx`) leaves the guard GREEN. The assertion's intent ("has a call outside the barrel") is therefore not enforced for at least one of the 23 actions, and is enforceable for the rest only by accident. |
| AS-131 | PASS | — | Mutation (`pageKindEnum` + `"fake_kind_xyz"`) produced a real FAIL: 2 of 4 tests RED with a value-level diff. Re-verified plausible against the code. |
| AS-132 | PASS | — | Mutation (drop `"cms"` from `SECTION_KINDS`) produced real FAIL output with a value-level diff; revert confirmed via empty `git diff`. |
| AS-133 | **FAIL** | **blocker** | The captured FAIL is real, but it proves a **weaker** property than AS-133 asserts. Both F039 and F040 handoffs explicitly record that removing the import alone does **not** fail the guard — the workers had to delete the doc-comment mention as well to make it go RED. What was demonstrated is "the guard catches an action with zero textual mentions", not "the guard catches an action with no call site". The demonstration is honest but the underlying guard does not catch the realistic dead-action case (stale comment left behind). |
| AS-134 | PASS | — | Independently grepped both guard files for `guard-ignore`/`allowlist`/`eslint-disable`/`skipIf`/`.skip`/`todo(` — no matches. No env-var bypass, no exclusion array beyond the structural barrel/leaf/test filters that AS-130 itself specifies. |

## Detailed findings

**F1 (blocker, AS-130/AS-133) — text-scan guard is unsound in the "used" direction.**
`tests/unit/m6-action-barrel-guard.test.ts:85` uses `new RegExp("\\b" + actionName + "\\b")`
against raw file content. Comments, JSDoc, string literals and unrelated
identifiers all satisfy it. 21 of 23 actions currently have exactly one matching
file, so the guard happens to be tight today, but `changePageKind` is already
blind, and the names (`createPage`, `createComponent`, `deleteSection`,
`renameComponent`) are generic enough that any future unrelated identifier
re-blinds another one. The guard has no mechanism to notice this degradation.

**F2 (major) — assertion IDs inside `m6-check-value-guard.test.ts` do not match the contract.**
`missions/20260919-150607/features/F037-check-value-ui-guard.md:30-33` defines
AS-127 = "parses from SQL, not hardcoded", AS-128 = page_kind identical,
AS-129 = section_kind identical. The test labels AS-126 = page_kind identical,
AS-127 = page_kind subset, AS-128 = section_kind identical, AS-129 = section_kind
subset. Every `it()` title names a different assertion than the contract does.
Anyone grepping `AS-128` lands on the section_kind test.

**F3 (major) — CHECK parser regex is not bounded to its own statement.**
Probed: given
`alter table t add constraint tasks_page_kind_check check (page_kind = 'static');`
followed by `create policy p on t using (status in ('todo','done'));`,
`findLastCheckConstraintValues` returns `["todo","done"]`. The in-file comment
claims anchoring prevents this; it only prevents wandering from *later mentions
of the name*, not past the `;`.

**F4 (major) — non-`IN` CHECK forms are invisible and do not throw.**
`= ANY (ARRAY['static','cms'])` (which is exactly how Postgres itself renders a
CHECK via `pg_get_constraintdef`), inline `create table` constraints, and
`drop constraint` without re-add all yield **zero matches**. Because the function
only throws when *no* migration anywhere matched, it silently falls back to the
last older `IN`-style definition and the test goes green while the live DB has
drifted. This defeats the feature's stated purpose and violates the DoD line
"parsing is robust and takes the LAST CHECK for that constraint" — it takes the
last *parseable IN-style* CHECK.

**F5 (minor) — dead code / discarded diagnostics.**
`lastMatchFile` is computed then discarded via `void lastMatchFile`, so failure
output never names the authoritative migration. In the barrel guard,
`m6-action-barrel-guard.test.ts:34-37` (the `precedingText` / `/type\s*$/` skip)
is unreachable — `/export\s*\{/` cannot match `export type {` — so the comment
describes a protection that never runs.

**F6 (minor) — `export * from` is uncovered.**
A barrel fully converted to star exports fails the `toBeGreaterThan(0)` test, but a
**mixed** barrel (one `export { }` block retained, the rest starred) passes with
silently reduced coverage and no signal.

**F7 (minor) — failure message polarity.**
`expect(new Set(zodValues)).toEqual(new Set(dbValues))` makes Zod the "Received"
and DB the "Expected", so the Vitest diff reads inverted from how the DoD phrases
it ("which values are in DB but not Zod and vice versa"). Information is present
but unlabelled. The subset tests print only `expected false to be true` — they do
not name the offending value at all.

**F8 (informational) — full-suite counts.**
`npx vitest run` at M6 HEAD: 263 failed files / 206 failed tests — **byte-identical
to the M5 baseline** recorded in `M5-scrutiny-3.md:141-142`. No M6 regression.
Total test count moved 6448 → 6416 (-32) while M6 added 6; this is file-level
abort variance in the pre-existing failing suites, not an M6 deletion (M6 touched
only two new test files). Flagged as unexplained but non-blocking.

## AS-006 gate

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS (no output) |
| `npx eslint` on the three M6 files `--max-warnings 0` | PASS (exit 0, no output) |
| `npm run migrations:check` | PASS — "No migration drift — all migrations present on remote." |
| `npx vitest run` (2 M6 files) | PASS — 2 files, 6 tests |
| Full `npx vitest run` | Pre-existing failures unchanged from M5 baseline |

## Recommended follow-up features

**FU-A (blocker, closes AS-130/AS-133) — make the barrel guard syntactic, not textual.**
Rewrite the usage detection in `tests/unit/m6-action-barrel-guard.test.ts` so a file
counts as a consumer only if the action name appears in a real binding position:
either inside an `import { ... }` clause whose specifier resolves to
`@/lib/actions/architecture`, or as a call expression `Name(`. Strip line and block
comments and string literals from the source before scanning, or parse with the
TypeScript compiler API (already a dependency) and walk identifiers, skipping
`JSDoc`/comment trivia. The acceptance bar is concrete: deleting the sole import +
call of `changePageKind` from `components/architecture/page-kind-selector.tsx` while
leaving the comment at `lib/validation/architecture.ts:63` intact must turn the test
RED. Additionally assert the parsed action count against an explicit expected number
and `expect.fail` if `export *` appears in the barrel, so coverage cannot silently
shrink. No allowlist may be introduced (AS-134 stands).

**FU-B (blocker-adjacent, closes AS-128/AS-129) — harden the CHECK constraint parser.**
Replace the unbounded `[\s\S]*?` search in `findLastCheckConstraintValues` with a
statement-bounded scan: locate `\bconstraint\s+<name>\s+check\s*\(` (drop the
mandatory `add\s+` so inline `create table` constraints are seen), then balance
parentheses from that offset rather than scanning to the next `)`. Support the
`= ANY (ARRAY[...])` rendering in addition to `IN (...)`. Critically, track *every*
textual mention of the constraint name across migrations in file order, including
`drop constraint`, and **throw** if the last mention is a definition or drop the
parser could not interpret — the function must never silently fall back to a stale
earlier list. Prove with a fixture-based mutation: an `ANY(ARRAY[...])` redefinition
that widens the DB list must turn the test RED, and a drop-without-re-add must throw.

**FU-C (major) — realign assertion IDs and delete the vacuous subset tests.**
Delete the two subset `it()` blocks (currently labelled AS-127 and AS-129) — they are
implied by the Set-equality assertions and cannot fail independently. Retitle the
remaining blocks to match `F037-check-value-ui-guard.md`: AS-128 for page_kind,
AS-129 for section_kind, and add one genuinely independent AS-127 test that proves
the parser is really reading the filesystem — e.g. assert
`findLastCheckConstraintValues("tasks_nonexistent_check")` throws, which a hardcoded
implementation could not satisfy. While in the file, surface `lastMatchFile` in the
failure message and replace the Set comparison with explicit `onlyInDb` / `onlyInZod`
arrays so the diff labels both drift directions. Also delete the unreachable
`precedingText` skip at `m6-action-barrel-guard.test.ts:34-37` and correct its comment.

**FU-D (minor, optional) — inverse barrel completeness.**
New assertion (not AS-130): every async function exported from
`lib/actions/architecture/*.ts` is re-exported by `lib/actions/architecture.ts`.
The current guard only catches barrel-exported-but-unused, never
defined-but-never-exported.

---

## Appendix — full command output

### `npx tsc --noEmit 2>&1 | tail -5`
```
(no output — clean)
```

### `npx eslint lib/validation/architecture.ts tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --max-warnings 0 2>&1 | tail -10`
```
ESLINT_EXIT=0
(no diagnostics)
```

### `npm run migrations:check`
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```

### `npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts 2>&1 | tail -20`
```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1).
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1).

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  00:57:55
   Duration  212ms (transform 63ms, setup 111ms, import 55ms, tests 77ms, environment 0ms)
```

### Allowlist grep (AS-134)
```
$ grep -rn "guard-ignore|allowlist|ALLOWLIST|eslint-disable|skipIf|it.skip|describe.skip|todo(" tests/unit/m6-*.ts
NO_ALLOWLIST_FOUND
```

### `npx vitest run` (full suite)
```
 FAIL  tests/unit/watching-feed-query.test.ts > getWatchedTasksForUser (query layer)
TypeError: supabase.rpc is not a function
 ❯ Module.getWatchedTasksForUser lib/queries/watching.ts:112:6
   (pre-existing, unrelated to M6)

 Test Files  263 failed | 591 passed | 2 skipped (856)
      Tests  206 failed | 4514 passed | 1696 skipped (6416)
   Duration  166.73s
```
M5 baseline for comparison (`M5-scrutiny-3.md:141-142`):
```
 Test Files  263 failed | 589 passed | 2 skipped (854)
      Tests  206 failed | 4546 passed | 1696 skipped (6448)
```
