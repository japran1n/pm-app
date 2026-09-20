# M9 — Scrutiny report #2

Mission: 20260919-150607
Validator: scrutiny-validator (adversarial, read-only)
Date: 2026-09-20
HEAD: 7cbc3512
Pass 1: `missions/20260919-150607/milestones/M9-scrutiny-1.md`

Features reviewed: F126, F127, F128, F129, F130 (follow-up fixes) plus re-check of
F049 (AS-168, AS-169), F050 (AS-172, AS-173), F051 (AS-178…182, AS-006).

## Verdict: **FAIL — milestone not green**

The AS-006 gate is now genuinely green (all four commands exit 0, and the unit
suite was fixed by repairing mocks, not by weakening assertions — verified
diff-by-diff). That is real progress and F130 is the strongest work in this
batch.

But **6 of 13 assertions still fail**, and two of the five follow-up features
did not achieve what they were commissioned to achieve:

- **F126 (AS-168)** added a git-based discovery function that is **dead code** —
  the command it runs can never return a migration path, so the hardcoded
  fallback always executes. The list happens to be correct today (independently
  verified: exactly three migrations were added by this mission), so the defect
  is invisible. A fourth migration added tomorrow is silently unchecked.
- **F127 (AS-169)** built a real SQL classifier, but still feeds it the same
  hardcoded three files — none of which classify as additive. The ordering
  comparison **never executes**; the test falls to an `else` branch asserting
  `expect(true).toBe(true)`.

Three assertions (AS-170, AS-171, AS-174) were not assigned a follow-up feature
at all and remain exactly as pass 1 left them: attested in a handoff, enforced
nowhere.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-006 | PASS | major (see note) | All four gate commands exit 0: `tsc --noEmit` 0, `npm run lint` 0 errors, `migrations:check` 0, `vitest run tests/unit` **504 passed / 1 skipped, 0 failed**. F130's 9 fixes are legitimate mock/timing repairs — no `expect` deleted, no `.skip`/`.todo` introduced, no production code changed. **Major caveat:** CI runs `npx eslint . --max-warnings=0` (`.github/workflows/ci.yml:54,138`), which **exits 1** on 7 warnings. The local `npm run lint` script omits `--max-warnings=0`, so the gate as specified is weaker than the project's own CI. Secondary: `npm test` is unscoped `vitest run`; CI scopes to `tests/unit`, which legitimises the scope but leaves `npm test` red. |
| AS-168 | FAIL | major | `discoverMissionMigrations()` (m9-migration-headers.test.ts:23-33) runs `git log --diff-filter=A --name-only --pretty=format: missions/20260919-150607/ \| grep "supabase/migrations"`. The pathspec restricts `--name-only` output to files *under the mission directory*, so no migration path can ever appear. Verified: empty output, exit 0 → the hardcoded fallback (:17-21) always wins. **Mutation-proven:** a new migration `20261127150000_zz_throwaway.sql` with a bare `--` header and a `DROP COLUMN` was added → suite stayed **green**. Separately, the content floor (`/^--\s+\S.{18,}/m`, :50) is a 20-character length gate applied anywhere in the file (`/m`, not anchored to line 1); a header reading `-- tweak column defaults here now ok` on a migration that drops a column **passes**, so "explains why it exists and what it changes" is unenforced. Pass-1's omission of `20261127120000_...` is fixed; the mechanism is not. |
| AS-169 | FAIL | blocker | Same dead discovery. The classifier (:59-70) is real, but applied to only 3 files, **none of which classify as additive**: `20261127120000` does `DROP NOT NULL` / `DROP CONSTRAINT` / `ADD CONSTRAINT`, matching neither regex; the other two are pure drops. So `additive.length === 0` → the `else` branch (:91-95) runs `expect(additive.length === 0 \|\| destructive.length === 0).toBe(true)` — a tautology. **The ordering comparison at :87-90 never executes.** The "self-check" at :75-76 sits *inside* `if (additive.length > 0 && destructive.length > 0)`, so it asserts only what the guard already guarantees. **Mutation-proven:** a synthetic `ADD COLUMN` migration dated `20261128999999` (after all drops) → suite stayed **green**. Also: comments are not stripped before regex matching, so a header comment mentioning `DROP COLUMN` would misclassify the file. Finally, the test carries a comment at :81-86 describing a mutation check as "documented, not executed" — a confession in place of a check. |
| AS-170 | FAIL | blocker | Unchanged from pass 1; no follow-up feature was commissioned. `scripts/check-migration-drift.mjs` exists and I ran it clean today, but it is invoked **nowhere in `.github/workflows/ci.yml`** (grep for `migrations:check` returns nothing). The assertion is attested by a one-off manual run recorded in a handoff, not enforced. |
| AS-171 | FAIL | blocker | Unchanged. `supabase db diff --use-migra` was never successfully executed (F050 handoff records `LegacyImagePrepullError`, no Docker) and a `db:gen-types` byte-identity proxy was substituted, then the assertion was labelled PASS. No test, no run. |
| AS-172 | PASS | — | `m9-migration-check.test.ts:11`. Re-verified: `expect(match).not.toBeNull()` runs before the negative check, so re-adding `description` to `page_components` Row/Insert/Update is caught and a formatting change fails loudly rather than passing vacuously. |
| AS-173 | PASS | — | Same structure for `architecture_node_meta.client_visible` (:22). Caveat unchanged: both rest on the generated types file being fresh — the premise AS-174 fails to guarantee. |
| AS-174 | FAIL | blocker | Unchanged; no follow-up commissioned. No automated freshness check exists. A single manual `db:gen-types` + `git status` in a handoff. AS-172/AS-173 are load-bearing on this unverified premise. |
| AS-178 | FAIL | major | The SHA-256 guard (m9-regression.test.ts:10-49) is a real improvement over pass 1's spelling check, and the hash **is** correctly pinned pre-mission — I independently recomputed it from `git show 985e8cbe:components/portal/status-label.ts` and got `54989a5a…09167`, identical to `EXPECTED_HASH` and to HEAD. Brace-matching extraction and normalisation are sound, and flipping `category !== "done"` turns it **red** (confirmed). **But the hashed span is the wrong boundary.** `resolveClientBucket` is a 4-line dispatcher; its semantics live in `CLIENT_BUCKETS` (status-label.ts:16-21), `isClientBucket` (:23-25) and `CATEGORY_BUCKET_FALLBACK` (:40-44) — all **outside** the hash. Mutating `CATEGORY_BUCKET_FALLBACK.not_started` from `"progress"` to `"waiting"` and inverting `isClientBucket` left the suite **green**. That first mutation is precisely the defect the file's own comment at :27-39 calls "the single most client-damaging defect the M1 re-scrutiny found". The function's output can be changed for every input without touching a hashed byte, so CLAUDE.md's "must never be changed" rule is not guarded. Minor secondary: if the declaration existed with no following `{`, `extractFunctionSpan` hashes the rest of the file; and an added overload signature would make `indexOf` match the wrong declaration. |
| AS-179 | PASS | minor | True in fact: `tsconfig.json` includes `components/portal/**` (exclude is only `node_modules`, `extension`), `npx tsc --noEmit` exits 0, and — correcting pass 1 — CI **does** run `npm run build` (`next build`) at `.github/workflows/ci.yml:56-57`. However there is **no `it()` block for AS-179** in `m9-regression.test.ts` despite AS-179 appearing in the `describe` title (:35). The title advertises coverage that does not exist; a green M9 suite is zero evidence for this assertion. Either write the test or strike AS-179 from the title. |
| AS-180 | FAIL | major | Pass-1's two findings are genuinely fixed and mutation-proven: deleting `page_kind` from `TASK_COLUMNS` (architecture.ts:76) → **red**; re-adding `description` to `COMPONENT_COLUMNS` (:91) → **red**. The test reads the real source rather than duplicating it. **But the positive half of "still returns … `page_components`" is still unasserted for the component columns.** Setting `COMPONENT_COLUMNS = "id"` — dropping `name` and `position`, both rendered by `buildBoardFromRows` (architecture.ts:149, 169-171) — left the suite **green**. The board silently loses component names and ordering with no test failing. Secondary: both extraction regexes require a single double-quoted literal, so reformatting to a template literal breaks the test — fail-safe but noisy. |
| AS-181 | FAIL | major | The **action half is fixed and mutation-proven**: the scan is genuinely tree-wide (`grep -r … app/ components/ lib/`, :89), and adding a deep import `from "@/lib/actions/architecture/node-meta"` to `components/architecture/client-board.tsx` — bypassing the barrel — turns it **red**. The exclusion filters (`.test.`, `.spec.`, `missions/`, `handoffs/`, `__tests__/`) are safe; the last three are dead code since no such directory exists under the scanned roots. **The dropped-column half of the assertion remains entirely unguarded.** Appending `sb.from("architecture_node_meta").select("id, client_visible")` to `lib/queries/architecture-details.ts` left `m9-regression`, `m9-migration-check` and `m6-action-barrel-guard` all **green**, and `tsc --noEmit` silent. AS-180's `not.toMatch(/node_meta/i)` is scoped to `lib/queries/architecture.ts` alone; AS-172/173 check only the generated types file. Five production files still reference `node_meta`. |
| AS-182 | PASS | — | `m6-action-barrel-guard.test.ts`. `EXPECTED_ACTION_COUNT = 25` (:198) hand-verified correct (8 pages + 7 sections + 1 node-details + 1 `setNodeMeta` + 7 components + 1 estimates). Mutation-proven three ways: adding an unused barrel export → **both** guards red (`expected 26 to be 25`, plus the no-call-site failure); a call-shaped mention placed only in a comment and a string literal does **not** satisfy the guard (comment/string stripping at :62-130 works); replacing it with a real call turns the call-site test green as expected. Genuinely well-built. Two fail-safe nits: an action passed by reference (`action={createPage}`) reads as unused, and the specifier regex `/lib\/actions\/architecture/` (:223) also matches deep imports, so a deep-import call site can keep a dead barrel export alive. |

**Score: 5 PASS / 8 FAIL — 3 blockers, 5 majors.**

Working tree verified clean after all mutation testing
(`git status --porcelain -- lib components app supabase tests` is empty).

### Note on a reported flake
One reviewer observed AS-180 failing on `page_kind` in an otherwise-clean run.
This was contention between two concurrent reviewers mutating
`lib/queries/architecture.ts`. Re-run in isolation: `m9-regression`,
`m9-migration-check` and `m6-action-barrel-guard` → **3 files / 7 tests passed**.
Not a flake.

## Recommended follow-up features

**FU-8 — Migration discovery that actually discovers (AS-168, AS-169; supersedes FU-1/FU-2).**
Both AS-168 and AS-169 fail for the same root cause, so fix it once.
`discoverMissionMigrations()` in `tests/unit/m9-migration-headers.test.ts` must
stop using a pathspec-scoped `git log --name-only`, which is structurally
incapable of returning migration paths. Replace it with either (a) `readdirSync`
over `supabase/migrations/` filtered to timestamps `>= 20261127120000`, or
(b) `git log --diff-filter=A --format=%H -- missions/20260919-150607/` followed
by `git show --name-only` on each of those commits, filtered to
`supabase/migrations/*.sql`. Then **delete the hardcoded fallback entirely** and
assert the discovered count is non-zero, so an infrastructure failure produces a
red test rather than a silent substitution. Acceptance is by mutation, executed
not documented: a throwaway migration with a bare `--` header must turn AS-168
red, and a throwaway `ADD COLUMN` migration dated after `20261127140000` must
turn AS-169 red.

**FU-9 — Make AS-168's content floor semantic, and AS-169's classifier honest.**
Anchor the AS-168 header check to the file's **first line** (drop the `/m` flag)
and replace the 20-character length gate with a relevance check: parse the
table and column identifiers out of the migration's DDL and require the leading
comment block to mention at least one of them, so a generic 40-character
sentence no longer satisfies "explains what it changes". For AS-169, strip `--`
line comments and `/* */` blocks before applying the additive/destructive
regexes (today a header mentioning `DROP COLUMN` misclassifies the file), widen
the regexes to cover `ALTER … DROP CONSTRAINT` and `DROP NOT NULL`, and move the
non-vacuity assertion **outside** the `if (additive.length > 0 && destructive.length > 0)`
guard so an empty additive set fails loudly instead of short-circuiting to
`expect(true).toBe(true)`. Delete the "mutation check (documented, not executed)"
comment at lines 81-86 and execute it.

**FU-10 — Behavioural truth table for `resolveClientBucket` (AS-178; supersedes FU-4).**
The SHA-256 hash is correctly pinned pre-mission and should stay, but it guards
a 4-line dispatcher whose behaviour is defined by `CLIENT_BUCKETS`,
`isClientBucket` and `CATEGORY_BUCKET_FALLBACK` — all outside the hashed span,
all freely mutable today. Add a second test that pins **behaviour**: enumerate
every `(category, storedBucket, pendingClientApproval)` combination —
3 categories x {null, each of the 4 buckets, a garbage string} x {true, false},
roughly 36 cases — and assert each return value against a table checked into
the test with a comment pointing at the CLAUDE.md immutability rule. Extend the
hash to cover the three helper declarations as well, and harden
`extractFunctionSpan` to assert `braceStart !== -1`, `depth === 0` at exit, and
`normalized.length > 100`. Acceptance by mutation: flipping
`CATEGORY_BUCKET_FALLBACK.not_started` from `"progress"` to `"waiting"` must
turn the suite red.

**FU-11 — Complete the AS-180 positive assertion and the AS-181 dropped-column scan.**
Two narrow gaps remain after F129. For AS-180, add
`expect(componentColumns).toContain("name")` and `.toContain("position")`
alongside the existing negative check, so the component column set cannot be
gutted silently — today `COMPONENT_COLUMNS = "id"` passes while the board loses
component names and ordering. Consider capturing the argument actually passed to
`.select(...)` at runtime (the pattern already used in
`lib/queries/architecture-details.select.test.ts`) rather than regex-extracting
a double-quoted literal, which breaks on reformatting. For AS-181, add a
tree-wide scan of `app/**`, `components/**`, `lib/**` (excluding tests and
`lib/supabase/database.types.ts`) for reads of the two dropped columns —
`page_components.description` and `architecture_node_meta.client_visible` —
since today a `.select("id, client_visible")` on `architecture_node_meta` added
to `lib/queries/architecture-details.ts` passes every test and `tsc`. Note that
`client_visible` is a **live** column on `page_components` and `sections`, so the
scan must be qualified by table, not by bare column name.

**FU-12 — Enforce AS-170, AS-171 and AS-174 in CI instead of attesting them.**
These three assertions have no follow-up feature and no automated coverage at
all; each is backed by a single manual run recorded in a handoff, and AS-171's
run never actually succeeded (`LegacyImagePrepullError`, no Docker — a
`db:gen-types` byte-identity proxy was substituted and the assertion was
nonetheless marked PASS). Add a CI job that (1) runs `npm run migrations:check`
— the script already exists and the `ci` job already holds the credentials it
needs — and (2) runs `npm run db:gen-types` into a temp file and diffs it
against the committed `lib/supabase/database.types.ts`, failing on any
difference. Item (2) is the single highest-value missing check in this mission:
it subsumes AS-174, removes the regex fragility underpinning AS-172/AS-173, and
catches a dropped column being re-added upstream. For AS-171, either provision
Docker on the runner so `supabase db diff --use-migra` can genuinely run, or
amend the assertion to name the types-diff proxy as the accepted verification
method — do not leave a PASS resting on an error.

**FU-13 — Align the lint gate with CI (AS-006).**
`npm run lint` is bare `eslint`, which exits 0 on the repo's current 7 warnings,
while `.github/workflows/ci.yml:54` and `:138` run
`npx eslint . --max-warnings=0`, which **exits 1** on the same tree. The
milestone gate therefore passes a check that CI fails. Either add
`--max-warnings=0` to the `lint` script and clear the 7 warnings (3 are
auto-fixable unused `eslint-disable` directives; the rest are unused variables
needing an `_` prefix), or explicitly document that AS-006's lint leg means
"0 errors". The same ambiguity applies to the test leg: `npm test` is unscoped
`vitest run` and is red against unreachable Supabase, while CI and this gate
scope to `tests/unit`. Add an explicit `test:unit` / `test:integration` split so
"the suite passes" has one unambiguous meaning.

---

# Appendix — full gate output

## `npx tsc --noEmit`
```
exit 0 (no output)
```

## `npm run lint` (the gate command)
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

exit 0
```

## `npx eslint . --max-warnings=0` (what CI actually runs)
```
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 7 problems (0 errors, 7 warnings)
  0 errors and 3 warnings potentially fixable with the `--fix` option.

ESLint found too many warnings (maximum: 0).
exit 1
```

## `npm run migrations:check`
```

> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
exit 0
```

## `npx vitest run tests/unit`
```
 Test Files  504 passed | 1 skipped (505)
      Tests  3339 passed | 3 skipped (3342)
   Duration  83.23s (transform 6.16s, setup 60.60s, import 101.84s, tests 57.01s, environment 68.62s)
exit 0
```

## M9 test files re-run in isolation
```
npx vitest run tests/unit/m9-regression.test.ts tests/unit/m6-action-barrel-guard.test.ts tests/unit/m9-migration-check.test.ts
 Test Files  3 passed (3)
      Tests  7 passed (7)
```
