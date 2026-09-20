# M1 scrutiny — pass 4

Mission: 20260920-124226 · Milestone M1 (F002–F007, re-verified after F042–F050)
Date: 2026-09-20 · Reviewer: scrutiny validator (adversarial, read-only). No project file modified
(`git status --porcelain lib tests` clean; all mutation work ran against copies in the scratchpad).

## Verdict: RED

The two items this pass was asked to confirm both landed:

- **AS-022 / `toUtcMs` is fixed.** F049's explicit-offset regex is the right approach and
  covers the format the database actually returns. Verified by direct execution.
- **AS-058 is fixed.** F050's fixture inversion gives the test teeth. Verified by mutation.

But mutation-testing the rest of the file surfaced **two new non-falsifiable assertions of
the same root cause** — AS-003 and AS-008. They were marked PASS in pass 3 on a read-through;
they do not survive execution. Under the standing rule ("a test that only confirms the
implementation is a FAIL even if it passes today"), M1 cannot be GREEN.

---

## 1. AS-022 — verified fixed

`lib/calendar/stacked-window.ts:28`

```ts
const EXPLICIT_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
```

Executed against the real module (not reasoned from reading):

```
2026-09-23T09:00:00+00:00        -> [09:00Z – 10:00Z]   <-- PostgREST timestamptz, pass-3 blocker, now correct
2026-09-23T11:00:00+02:00        -> [09:00Z – 10:00Z]   <-- offset honoured, not stripped
2026-09-23T05:00:00-05:00        -> [10:00Z – 11:00Z]
2026-09-23T09:00:00.123456+00:00 -> [09:00.123Z – 10:00.123Z]   <-- microseconds + offset
2026-09-23T09:00:00+0000         -> [09:00Z – 10:00Z]
2026-09-23T09:00:00Z             -> [09:00Z – 10:00Z]
2026-09-23T09:00:00              -> [09:00Z – 10:00Z]   <-- offset-less still treated as UTC (F046's goal)
2026-09-23 09:00:00+00:00        -> [09:00Z – 10:00Z]   <-- space separator + offset
2026-09-23T07:00:00+00:00        -> clipped to [08:00Z – 16:00Z]   <-- AS-022's actual claim
```

The explicit-offset approach is correct and preferable to try-parse: it is deterministic and
does not depend on engine leniency for `"…+00:00Z"`. The `\d{2}:?\d{2}` shape is deliberate
and documented. One gap remains (below), but the live data path is sound.

**Residual gap — two-digit offsets (`+00`, `-05`) still return `[]` silently.** Both reviewers
found this independently:

```
2026-09-23T09:00:00+00  -> []      (Z appended -> "…+00Z" -> Invalid Date -> NaN guard -> [])
2026-09-23 09:00:00+00  -> []      (PostgreSQL's default psql text output)
```

This is a narrowing relative to F046, whose looser regex happened to match `+00`. It is **not**
on the application's data path — Supabase/PostgREST emits `+00:00`, and this repo's own
`tests/integration/calendar-blocks-crud.test.ts:288` pins `"2026-04-03T09:00:00+00:00"` — so
it is scored `major`, not `blocker`. The in-code rationale for requiring four digits ("so it
doesn't false-match on a bare `-05` date fragment") is wrong: a date-only ISO string never
ends in `[+-]dd`. Minimal fix: `/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i`.

## 2. AS-058 — verified fixed

Both requested checks pass, by execution:

**(a) Comparator mutation kills tests.** Replacing the entire `rest.sort` body with
`return a.id.localeCompare(b.id)` fails **3 tests**. Pass 3's finding (all five tests green
under that mutant) is resolved — the fixtures now have id-order disagreeing with name-order.
Two further mutants also killed: self-sorted-last (8 failures), nulls-first (3 failures).

**(b) Order-stability holds.**

```
orderPeopleForWholeTeam([{id:"zz",name:"Alice"},{id:"aa",name:"Bob"}], "self")  -> ["zz","aa"]
orderPeopleForWholeTeam([{id:"aa",name:"Bob"},{id:"zz",name:"Alice"}], "self")  -> ["zz","aa"]
```

Identical. The `localeCompare(…, "en", {sensitivity:"base"})` primary plus the code-unit and
id tie-breakers make the comparator total, so `Array.prototype.sort`'s implementation-defined
behaviour for equal elements is never reached.

## 3. Newly failing: AS-003 and AS-008 (one root cause)

`tests/unit/planner-people-selection.test.ts:14-15`

```ts
const SELF_ID = "member-self";
const ACTIVE_MEMBER_IDS = ["member-self", "member-a", "member-b", "member-c"];
```

`selfId` is also `activeMemberIds[0]` in **every** fixture. So "resolves to the signed-in
member" and "resolves to the first member of the roster" are indistinguishable. Confirmed by
running the real suite against a mutated copy of the module:

| Mutant | Result |
|---|---|
| `"me"` and the empty/no-param path both `return [activeMemberIds[0] ?? selfId]` | **31/31 tests pass** |
| all-invalid fallback `return [activeMemberIds[0] ?? selfId]` | **31/31 tests pass** |

An implementation that ignores `selfId` entirely and always returns the roster's first member
satisfies the whole AS-003 / AS-008 suite. The implementation is in fact correct; the tests
cannot tell. This is precisely the defect pass 3 raised as a blocker for AS-058, unaddressed
here because nobody mutation-tested the `me` path.

The fix is one fixture: assert `parsePeopleParam("me", { selfId: "member-c", activeMemberIds:
ACTIVE_MEMBER_IDS })` → `["member-c"]`, and the same for the all-invalid and no-param cases.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-003 | **FAIL** (blocker) | Non-falsifiable: mutating `"me"` → `[activeMemberIds[0]]` leaves 31/31 green; selfId is always roster[0] in the fixtures. |
| AS-004 | PASS | `all` → full roster; mutants "return selfId" and "roster minus last" each kill 5 tests. Normalisation (`ALL`, `" all "`, `"all,"`, `"all,,"`) covered. |
| AS-005 | PASS | Single valid id ≠ selfId returns exactly that id; mutant collapsing it to selfId kills the test. |
| AS-006 | PASS | Comma list returns exactly the listed valid ids; mutant appending selfId kills the test. |
| AS-007 | PASS | Removing the `activeSet.has` drop kills 4 tests; survivors still take effect; no throw. |
| AS-008 | **FAIL** (blocker) | Fallback fires, but mutating it to `[activeMemberIds[0]]` leaves 31/31 green — the test cannot show the fallback targets *self*. Same fixture defect as AS-003. |
| AS-009 | PASS | `z,a,b` preserved; test asserts `not.toEqual(["a","b","z"])`; adding `.sort()` kills 3 tests. |
| AS-010 | PASS | Removing the `seen` dedupe kills 2 tests; adjacent and non-adjacent duplicates both covered. |
| AS-015 | DEFERRED | Re-homed to F031 by F044 per AUTONOMOUS_DECISION (run-log.md:54). Not counted. Must be a hard gate at F031. |
| AS-016 | INCONCLUSIVE | `resolvePlannerLayout` is mutation-covered at the unit level but has **zero callers** repo-wide. A rendering claim cannot be settled by an integer→string function. Expected; settle at F031. |
| AS-017 | INCONCLUSIVE | Same. Expected; settle at F031. |
| AS-018 | INCONCLUSIVE | `STACKED_START_HOUR === 8` / `=== 16` restates the literals; nothing renders eight hour rows. Helper-level window logic is sound (const mutant kills 7 tests, widened-window mutant kills 6). Expected; settle at F033. |
| AS-019 | INCONCLUSIVE | `STACKED_DAYS === [1..5]` restates the literal; nothing renders five columns. Mon–Fri derivation verified (Sun 22:00Z→Mon, Fri 15:00Z→Sat, Sat, Sun) and mutation-covered. Expected; settle at F033. |
| AS-020 | INCONCLUSIVE | Exclusion correct for every real timestamp format, but `toEqual([])` cannot distinguish "correctly excluded" from "failed to parse". No renderer. Settle at F033. |
| AS-021 | INCONCLUSIVE | Weekend exclusion verified; same `[]`-ambiguity and no renderer. Settle at F033. |
| AS-022 | INCONCLUSIVE | **Pass-3 blocker resolved** — clipping is correct and mutation-covered (dropping clipping kills 8 tests), and `+00:00`/`±HH:MM` now parse correctly with a regression test pinning the PostgREST format. Held INCONCLUSIVE only because no stacked layout renders anything yet; scored consistently with AS-020/021. Settle at F033. |
| AS-058 | PASS | **Pass-3 blocker resolved.** Comparator mutation kills 3 tests; output is order-stable under input permutation. |
| AS-072 | PASS | All three pure helpers have unit test files (57 tests across the three, all green). Quality caveats are recorded against the individual assertions above. |

Non-deferred FAILs: **2** (AS-003, AS-008). Both blocker. Verdict RED.

## Other findings (no assertion currently owns them)

| Finding | Severity | Where |
|---|---|---|
| `selfId` is never validated against `activeMemberIds`. `parsePeopleParam("bogus", {selfId:"ghost", activeMemberIds:["a"]})` → `["ghost"]` — the parser can emit a non-active id, contradicting AS-007's spirit. Carried unaddressed since pass 2. | major | `people-selection.ts:37,47,69` |
| Three distinct conditions — unparseable input, reversed interval, genuine non-overlap — all collapse to an indistinguishable `[]` with no throw and no log. This is the mechanism that hid the pass-3 blocker for a whole pass. | major | `stacked-window.ts:53-58` |
| `clipBlockToStackedWindow(null)` throws `Cannot read properties of null` — TypeScript-only protection, despite the defensive NaN guard two lines below. | minor | `stacked-window.ts:36` |
| `orderPeopleForWholeTeam` does not dedupe: two entries with `id === selfId` yield `["self","self",…]`. | minor | `people-selection.ts:95-96` |
| Empty-string name sorts *before* "Alice" while `null`/`undefined` sort last. The doc comment covers only null. Untested. | minor | `people-selection.ts:99-103` |
| A member whose id is literally `"me"` or `"all"` can never be selected alone, but *is* selectable inside a comma list. Harmless with UUIDs; unasserted. | minor | `people-selection.ts:46-53` |
| `serializePeopleParam([], selfId)` → `""`, which round-trips back to `[selfId]`. Lossy; untested. | minor | `people-selection.ts:79-84` |
| The AS-004 test asserts `toEqual(ACTIVE_MEMBER_IDS)`, pinning the input array's order — it over-specifies the assertion and silently disagrees with AS-058's ordering rule. Nothing reconciles the two. | minor | test:AS-004 |

## Recommended follow-up features

**F051 — Make the `me` / self-fallback paths falsifiable.** The `?people=` unit suite fixes
`SELF_ID` to `activeMemberIds[0]`, so every assertion about "the signed-in member" is
satisfiable by an implementation that returns the roster's first entry instead. Introduce a
fixture in which the signed-in member sits in the middle of the roster (e.g. `selfId =
"member-c"`) and add cases covering all three self-returning paths — `?people=me`, the
no-param/empty-string default, and the all-ids-invalid fallback — each asserting the result
is the signed-in member and explicitly `not.toEqual([ACTIVE_MEMBER_IDS[0]])`. Scope is test-only;
`parsePeopleParam` itself is already correct and must not change. Closes AS-003 and AS-008.

**F052 — Accept two-digit UTC offsets in `toUtcMs`.** `EXPLICIT_OFFSET_RE` requires four offset
digits, so `2026-09-23T09:00:00+00` and PostgreSQL's default text form `2026-09-23 09:00:00+00`
fail the guard, get a spurious `Z` appended, become `Invalid Date`, and are silently dropped as
`[]`. Widen the minute group to optional — `/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i` — correct the
stale in-code rationale about "a bare `-05` date fragment" (a date-only string never ends in
`[+-]dd`), and add regression cases for `+00`, `-05`, and the space-separated `+00` form
alongside the existing `+00:00` block. Hardens AS-020/021/022.

**F053 — Stop `[]` from meaning three different things.** `clipBlockToStackedWindow` returns the
same empty array for unparseable timestamps, reversed intervals, and genuine non-overlap, with
no throw and no log — this is what let the F046 regression survive an entire scrutiny pass and
what keeps AS-020/021 INCONCLUSIVE, since `toEqual([])` cannot distinguish correct exclusion from
total parse failure. Make parse failure observable: either throw on an unparseable timestamp
(callers construct these from trusted DB rows) or return a discriminated result the caller can
branch on, and add a test asserting that a malformed timestamp is *not* silently treated as
out-of-window. Include a runtime guard for `null`/`undefined` input.

**F054 — Validate `selfId` against the active roster.** `parsePeopleParam` returns `[selfId]`
from three paths without ever checking that `selfId` names an active member, so a stale session
can produce a selection containing a non-active id — the precise outcome AS-007 forbids for
ids arriving via the URL. Decide and encode the contract: either document that `selfId` is a
trusted caller invariant and assert it in the type/JSDoc, or filter it through `activeMemberIds`
and define what an empty result means. Add tests for `selfId` absent from the roster across all
three paths.

---

## Gate output

### `npx tsc --noEmit`

```
(no output)
EXIT 0
```

### `npx eslint . --max-warnings=0`

```
(no output)
EXIT 0
```

### `npx vitest run tests/unit` (compared against the F001 baseline)

```
 Test Files  41 failed | 466 passed | 1 skipped (508)
      Tests  133 failed | 3266 passed | 3 skipped (3402)
   Duration  86.14s
```

Baseline at F001 (run-log.md:19, HEAD 3b92c53e): **41 test files failed, 133 tests failed**,
recorded as pre-existing noise by AUTONOMOUS_DECISION. Identical counts — the mission has
introduced no new unit-test failure.

### `npx vitest run` (full suite, for the record)

```
 Test Files  297 failed | 574 passed | 2 skipped (873)
      Tests  310 failed | 4553 passed | 1703 skipped (6566)
   Duration  201.32s
```

The delta over `tests/unit` is integration and component suites that require live Supabase
credentials (`fetch failed` in `beforeAll`) — the same infrastructure constraint recorded for
F011 at run-log.md:47. No baseline exists for the full suite; F001 measured `tests/unit` only.
Recommend F041 establish one so this number stops being unfalsifiable.

### M1 helpers in isolation

```
npx vitest run tests/unit/planner-stacked-window.test.ts \
               tests/unit/planner-people-selection.test.ts \
               tests/unit/planner-layout.test.ts

 Test Files  3 passed (3)
      Tests  57 passed (57)
```

All green — which is exactly why the two FAILs above are recorded against tests that pass today.
