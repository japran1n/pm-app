# F108 — Fix AS-127/128/129: harden CHECK parser + realign assertion IDs

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-1 FU-B + FU-C)_

## Problem (FU-B — parser)

`tests/unit/m6-check-value-guard.test.ts` has a statement-unbounded regex 
`add\s+constraint\s+<name>\b[\s\S]*?\bin\s*\(` that crosses semicolons and 
picks up unrelated IN() lists. Also, `= ANY (ARRAY[...])` form (Postgres's 
native rendering) is not supported. If the last mention is a drop-without-re-add, 
the function silently falls back to a stale list instead of throwing.

## Problem (FU-C — vacuous tests + misaligned IDs)

Two `it()` blocks (currently labelled AS-127 and AS-129) are subset checks 
mathematically implied by the Set-equality assertion above them — they cannot 
fail independently. Also, `it()` titles don't match assertion IDs from the spec.

## Fix

**Parser rewrite:**
1. Replace unbounded `[\s\S]*?` with parenthesis-balanced scan: find 
   `\bconstraint\s+<name>\s+check\s*\(` (drop mandatory `add\s+` to catch 
   inline `create table` constraints), then count `(` and `)` to find the end
2. Support `= ANY (ARRAY['val1', 'val2', ...])` in addition to `IN ('val1', 'val2')`
3. Track ALL textual mentions of constraint name across migrations in file order
4. **Throw** if the last mention is a drop or a form the parser cannot interpret — 
   never silently fall back to stale data

**Test realignment:**
1. Delete the two vacuous subset `it()` blocks
2. Add a genuinely independent AS-127 test: assert `findLastCheckConstraintValues("tasks_nonexistent_check")` throws (a hardcoded impl cannot satisfy this)
3. Retitle remaining blocks: AS-128 for page_kind, AS-129 for section_kind
4. Surface `lastMatchFile` in failure message
5. Replace Set comparison with explicit `onlyInDb` / `onlyInZod` arrays in error output
6. Delete unreachable `precedingText` skip in barrel guard test at line ~34-37

## Assertions covered

- **AS-127**: parser genuinely reads filesystem (throws on unknown constraint name)
- **AS-128**: page_kind CHECK vs pageKindEnum — now using robust parser
- **AS-129**: section_kind CHECK vs sectionKindEnum — now using robust parser

## Definition of done

- `npx vitest run tests/unit/m6-check-value-guard.test.ts` passes (all 4+ tests)
- Parser handles `ANY(ARRAY[...])` form
- Unknown constraint name throws (not silently returns empty/stale)
- No vacuous subset tests remain
- Handoff documents fixture-based mutation proof:
  an ANY(ARRAY[...]) redefinition widening the DB list must turn the test RED
