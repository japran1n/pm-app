# M5 Scrutiny — round 3 (re-check after F102–F106)

Mission: 20260919-150607
Milestone: M5 (F031–F036, F094 + follow-ups F095–F106)
HEAD at review: `36c06984`
Reviewer: scrutiny validator (adversarial, read-only)

## VERDICT: GREEN

0 FAIL. 14 PASS + 1 INCONCLUSIVE (AS-111, unchanged and non-blocking under the
GREEN rule). All three round-2 failures (AS-114, AS-121, AS-089) were re-tested by
mutation, not by reading the diff, and all three now turn the suite RED.

## Assertion table

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-089 | PASS | — | `f104-page-column-chain.test.tsx` mounts the real `PageColumn`; deleting the `page-column.tsx:112` pass-through now goes RED (1 failed). Prop made required at all 4 internal layers, `?.()` leaf gone. Trigger gate fixed to `!== undefined` — reverting it to `!== null` goes RED. Enter/Space/focus-return tests added; regressing `<button>` to `<div role="button">` goes RED (4 failed). |
| AS-090 | PASS | — | Unchanged since round 2, where all three mutations were confirmed RED. Not touched by F102–F106. |
| AS-110 | PASS | minor | Row counts per dropped column recorded in F031-handoff; both migrations cite the evidence. The `client_visible` result is still filed under the "AS-111" heading in that handoff — cosmetic mislabel. |
| AS-111 | INCONCLUSIVE | major | Unchanged since round 1. No guard, script, or test implements the BLOCKED branch; both migrations are unconditional `drop column if exists`. No input can make this assertion fail — it is unfalsifiable as implemented, not violated. |
| AS-112 | PASS | minor | Migration `20261127130000` present; `database.types.ts` `page_components.Row` has no `description`. F102 correctly relocated this test out of the AS-114 block into its own `AS-112` describe, matching the contract. |
| AS-113 | PASS | — | `COMPONENT_COLUMNS = "id, name, position"`. Re-verified: rewriting it as a template literal containing `description` goes RED (the constant regex fails closed), as does a plain re-add. |
| AS-114 | PASS | — | **Round-2 failure fixed.** Regex is now `/["']?description["']?\s*\??\s*:/` — the `\?` is optional again, and quoted keys are covered. Mutation matrix re-run at HEAD: required `description: string;` → RED; `"description"?: string;` → RED; `} & { description?: string }` intersection → RED (whole-identifier scan); `ComponentRow` required re-add → RED; template-literal `COMPONENT_COLUMNS` with `description` → RED. Every round-2 green row is now red. |
| AS-115 | PASS | — | Unchanged. Live test asserts SQLSTATE `42703` on `select("client_visible")` with a companion query proving the table is still queryable. See "Environmental note" — the test is RED in this sandbox because no Supabase stack is listening on 127.0.0.1:54321; it fails loudly rather than silently passing, which is the correct failure mode. |
| AS-116 | PASS | — | Unchanged. Asserts `architecture_node_meta_select_client` is `undefined` in live `pg_policy`, not source text. Same environmental caveat as AS-115. |
| AS-117 | PASS | minor | Zero repo hits outside `missions/`. Guard is still three `toBeUndefined()` name lookups — a re-add under a different name would not be caught. Same residual risk as round 2, not a regression. |
| AS-118 | PASS | — | **Round-2 gap closed.** F106 added a source-text guard on the `NodeMeta` declaration in `lib/architecture/types.ts` for both `clientVisible` and `updatedBy`, with the same optional-`?` regex. Mutation re-run: adding `clientVisible: boolean;` to `NodeMeta` → RED. The stale `clientVisible`/`updatedBy` fixtures in `f096-invalidate-details-chain.test.tsx` are gone. Remaining `clientVisible` hits in `tests/` are all `BoardSection.clientVisible` (`tasks.client_visible`), a different and still-live concept. |
| AS-119 | PASS | — | Unchanged. F100's evidence includes a discriminating sanity query (23 tasks carry non-empty `description_text`, none component-linked), so `*/0` is a result rather than a broken filter. |
| AS-120 | PASS | — | Unchanged. `TASK_COLUMNS` excludes `description_text`; exactly 3 repo hits (declaration + two call sites), one constant. |
| AS-121 | PASS | — | **Round-2 failure fixed.** Two independent guards now exist: a whole-file source-text guard in `lib/queries/architecture-details.select.test.ts` (`expect(source).not.toMatch(/estimated_by/)`) and a `.select()` spy in `f070-architecture-details-readback.test.ts:216` that inspects the actual argument. Mutation re-run: widening the select string to `"…, estimated_by, updated_by"` → 4 failed across 2 files; the same widening via a template literal → 2 failed across 2 files. The round-2 hole (stub ignores the select argument) is closed at both the static and the spy level. |
| AS-122 | PASS | — | Unchanged. `f098` asserts all four team policies via `pg_get_expr` with strict `toBe`, hard-throws under CI without creds. Caveat carried forward from round 2: it reads the hosted prod project, not CI's migration-replayed stack, so it is a live-drift detector, not a migration-content gate. That matches the assertion's literal wording. |

## Notes and residual risk (none blocking)

### 1. AS-114's third test is narrower than its name claims
The "identifier does not appear anywhere in the declaration, including via
intersection/extends/Pick" test matches `/export type BoardComponent =[\s\S]*?;\n/`
— non-greedy to the **first** `;\n`, which for a multiline object type is the first
member (`id: string;`). It therefore scans only a fragment. It happens to catch the
intersection mutation because `} & { description?: string };` ends the declaration,
but a `Pick<>`/`extends`/`Omit<>` indirection spanning several lines would escape it.
The two sibling tests cover the object-literal body properly, so AS-114 is not at
risk today. Minor: the regex should be anchored on a brace-balanced or line-anchored
match rather than the first semicolon.

### 2. AS-111 remains structurally unverifiable
The assertion describes a control-flow branch ("column not empty ⇒ BLOCKED") that no
artefact implements. F031's handoff documents that both columns happened to be empty,
which is evidence for AS-110, not AS-111. Nothing in the repo would behave differently
if the columns had been non-empty. This is the single remaining item that a future
milestone should address if the contract is to be fully falsifiable.

### 3. Environmental note on the live-DB tests
`tests/integration/f033-drop-node-meta-client-visible.test.ts` (AS-115/AS-116) is RED
in this sandbox with `ECONNREFUSED 127.0.0.1:54321` — no local Supabase stack was
running. This is an environment condition, not a code regression: the test fails
closed. AS-115/AS-116 were verified against a live stack in round 2 and nothing in
F102–F106 touched them.

### 4. Repo-wide suite is broken outside M5 scope
The full `vitest run` is 263 failed files / 206 failed tests. This is **pre-existing
and unrelated to M5**: re-running two representative failures (`watching-feed-query`,
`f090-board-client-visibility`) at round-2's HEAD `3c0b4957` reproduces both failures
identically. Causes observed are a missing local Supabase stack and a `supabase.rpc is
not a function` mock drift in `lib/queries/watching.ts` consumers. None of the failing
files are among those touched by M5 or its follow-ups. Flagged for the orchestrator as
a separate cleanup concern — it is not an M5 blocker but it does mean M5's guards are
currently sitting in a suite that nobody can read a green light from.

### 5. Lint warnings
7 warnings, 0 errors. All 7 are in `code-editor` / `th-*` files from a different
mission. No M5 file appears.

## Recommended follow-up features

**FU-A (minor, AS-114 robustness).** Replace the first-semicolon-terminated regex in
the third AS-114 test with a brace-balanced extraction of the `BoardComponent` and
`ComponentRow` declarations, or simpler, scan from the `export type BoardComponent =`
token to the next top-level `export`/`const`/blank-line boundary. The current match
truncates at the first member, so the test's stated coverage of `Pick<>`/`extends`
indirection is aspirational rather than real. Add mutation evidence for a multi-line
`BoardComponent = Omit<ComponentRow, "x"> & { description?: string }` form.

**FU-B (major, AS-111 falsifiability).** Introduce an executable emptiness precondition
that the destructive migrations actually depend on — e.g. a `scripts/verify-column-empty.mjs`
invoked by the migration-apply path, or a test that asserts each `drop column` migration
in `supabase/migrations` is accompanied by a recorded non-zero-checked count in its
header comment and a matching handoff entry. The point is that some artefact must be
capable of producing a BLOCKED outcome; today nothing can. Note the contract is
immutable, so this is a new guard satisfying an existing assertion, not a rewording.

**FU-C (major, repo hygiene — outside M5).** Triage the 263 pre-existing failing test
files. At minimum, split the suite so that tests requiring a live Supabase stack are
gated behind an explicit project/tag and skip (loudly) when the stack is absent, rather
than failing. Right now M5's own AS-115/AS-116 guards are indistinguishable from the
noise, and no future validator can use "suite is green" as a signal.

**FU-D (minor, AS-117 rename resistance).** The `setNodeMetaClientVisibility` guard is
three name lookups. Add a source-text scan of `lib/actions/architecture/**` and
`lib/validation/architecture*` for the `client_visible` column name in any node-meta
context, so a re-add under a new function name is caught.

---

## Appendix — raw output

### Typecheck (`npx tsc --noEmit`)
```
(no output — clean)
```

### Lint (`npm run lint`)
```
/Users/sasajapranin/Desktop/pm-app/components/code-editor/editor-pane.tsx
  152:5  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/scripts/check-cron-health.mjs
  159:9  warning  'cutoffIso' is assigned a value but never used.  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-completion-providers.test.ts
  323:21  warning  'registered' is assigned a value but never used.  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-editor-lazy.test.tsx
  13:61  warning  'opts' is defined but never used.  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-link-interception.test.tsx
  34:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-monaco-editor.test.tsx
  157:7  warning  'configureMonacoCalledBeforeFirstMount' is assigned a value but never used.  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-origin-guard.test.ts
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 7 problems (0 errors, 7 warnings)
```

### Full test suite (`npx vitest run`)
```
 Test Files  263 failed | 589 passed | 2 skipped (854)
      Tests  206 failed | 4546 passed | 1696 skipped (6448)
   Duration  179.88s
```
Pre-existing: identical failures reproduce at round-2 HEAD `3c0b4957`.

### M5-scoped suites at HEAD (baseline, all green)
```
$ npx vitest run lib/queries/architecture.select.test.ts
      Tests  10 passed (10)

$ npx vitest run lib/queries/architecture-details.select.test.ts tests/unit/f070-architecture-details-readback.test.ts
 Test Files  3 passed (3)
      Tests  16 passed (16)

$ npx vitest run tests/unit/f104-page-column-chain.test.tsx \
      tests/unit/f096-invalidate-details-chain.test.tsx \
      tests/unit/f025-section-card-node-meta-icon.test.tsx
 Test Files  3 passed (3)
      Tests  11 passed (11)
```

### Mutation matrix executed this round (all reverted; working tree clean)

AS-114 — `lib/queries/architecture.ts`
```
required `description: string;` on BoardComponent   -> Tests  2 failed | 8 passed   RED
`"description"?: string;` (quoted key)              -> Tests  2 failed | 8 passed   RED
`} & { description?: string }` intersection         -> Tests  1 failed | 9 passed   RED
required `description: string;` on ComponentRow     -> Tests  2 failed | 8 passed   RED
COMPONENT_COLUMNS as template literal + description -> Tests  1 failed | 9 passed   RED
```

AS-121 — `lib/queries/architecture-details.ts`
```
baseline                                            -> Tests 16 passed              GREEN
select "…, estimated_by, updated_by" (dbl-quote)    -> Tests  4 failed | 12 passed  RED
same widening via template literal                  -> Tests  2 failed | 14 passed  RED
```

AS-089 — `components/architecture/*`
```
baseline                                            -> Tests 11 passed              GREEN
delete onDetailsInvalidate at page-column.tsx:112   -> Tests  1 failed | 10 passed  RED
stub onDetailsInvalidate at sortable-section-list   -> Tests  2 failed |  9 passed  RED
revert trigger gate to `detailsData !== null`       -> Tests  1 failed | 10 passed  RED
<button type="button"> -> <div role="button">       -> Tests  4 failed |  5 passed  RED
```

AS-118 — `lib/architecture/types.ts`
```
add `clientVisible: boolean;` to NodeMeta           -> Tests  1 failed |  9 passed  RED
```
