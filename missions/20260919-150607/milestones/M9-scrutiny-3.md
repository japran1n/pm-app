# M9 — Scrutiny report #3

Mission: 20260919-150607
Validator: scrutiny-validator (adversarial, read-only)
Date: 2026-09-20
HEAD: 3d3e0b33
Pass 1: `missions/20260919-150607/milestones/M9-scrutiny-1.md`
Pass 2: `missions/20260919-150607/milestones/M9-scrutiny-2.md`

Features reviewed this round: F131 (AS-168, AS-169), F132 (AS-178),
F133 (AS-180, AS-181), F134 (AS-006). Re-checked: AS-172, AS-173, AS-179, AS-182.
AS-170, AS-171, AS-174 are **deferred** (Docker/CI infrastructure) per the
orchestrator's instruction and are excluded from the score.

## Verdict: **PASS**

All ten in-scope assertions now hold, and — unlike passes 1 and 2 — every one of
the previously-failing mechanisms was proven by an **executed mutation**, not by
reading the code. The four fixes did what they were commissioned to do, and none
of them achieved green by weakening an assertion: no `expect` was deleted, no
`.skip`/`.todo` was introduced, and the only production-code edits in the batch
are seven cosmetic lint fixes (an unused-variable rename and three unused
`eslint-disable` directive removals) that carry no behaviour.

The two structural defects that dominated pass 2 are genuinely gone:

- The migration discovery function is no longer dead code. `readdirSync` over
  `supabase/migrations/` filtered to the mission timestamp window actually
  returns the three files, the hardcoded fallback is deleted, and the count is
  asserted non-zero so an infrastructure failure goes red rather than silently
  substituting a list.
- `resolveClientBucket`'s hash now spans `CLIENT_BUCKETS`, `isClientBucket` and
  `CATEGORY_BUCKET_FALLBACK`, and a 16-case behavioural truth table pins the
  output independently of the hash. The mutation pass 2 called "the single most
  client-damaging defect" now turns the suite red twice over.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-006 | PASS | — | All four gate commands exit 0 on a clean tree: `npx tsc --noEmit` **0**; `npx eslint . --max-warnings=0` **0** (pass 2's 7 warnings cleared — verified the diff is 4 unused-var `_` renames and 3 unused-disable deletions, no rule disabled, no `eslint.config.mjs` change); `npm run migrations:check` **0**; `npx vitest run tests/unit` **0** — 504 passed / 1 skipped files, 3340 passed / 3 skipped tests. |
| AS-168 | PASS | minor | `m9-migration-headers.test.ts:14-24`. Discovery is real (`readdirSync` + timestamp window `20261127120000…20261127149999`), fallback deleted, `expect(length).toBeGreaterThan(0)` at :41. Header check anchored to **line 1 only** (`firstLine`, no `/m`), so a matching later line can no longer rescue a bare `--`. **Mutation-proven, executed:** a throwaway migration `20261127145000_zz_throwaway.sql` with a `--` header → **red** ("must have a first-line -- comment with a real description"). Residual minor: the content floor is still a 20-character length gate, not a relevance check — a 40-character sentence unrelated to the DDL would pass. That is a prose-semantics limit no regex closes; accepted. |
| AS-169 | PASS | minor | Same real discovery. `stripComments()` (:31-35) removes `--` lines and `/* */` blocks before classification, closing pass 2's misclassification hole; the destructive regex now covers `DROP CONSTRAINT` and `DROP NOT NULL`, and the non-vacuity assertion sits **outside** the branch guard (:79). **Mutation-proven, executed:** a synthetic `ADD COLUMN` migration dated `20261127145000` — after both drops — turned AS-169 **red**. Residual minor: with today's three files `additiveOnly` is empty (the `120000` migration contains both additive and destructive DDL and is correctly excluded as self-contained), so the live run still takes the `else` branch; the ordering comparison is exercised only under mutation. The exclusion logic at :87-88 is sound, so this reflects the data, not the test. |
| AS-172 | PASS | minor | `m9-migration-check.test.ts:11-20`. `expect(match).not.toBeNull()` runs before the negative check, so a formatting change in the generated types fails loudly rather than passing vacuously; re-adding `description` to the `page_components` block is caught. Minor: load-bearing on the generated types file being fresh — the premise AS-174 (deferred) would guarantee. |
| AS-173 | PASS | minor | Identical structure for `architecture_node_meta.client_visible` (:22-29). Same freshness caveat, now partially mitigated by the AS-181 source scan below. |
| AS-178 | PASS | — | Hash span widened to four declarations (`m9-regression.test.ts:43-73`) and joined with a separator, plus a new `AS-178b` 16-case behavioural truth table (:76-136) covering 3 categories x {null, undefined, valid bucket, garbage string} x {true, false, omitted}. **Two mutations executed:** (a) `CATEGORY_BUCKET_FALLBACK.not_started` `"progress"` → `"waiting"` turned **both** AS-178 and AS-178b red; (b) inverting `isClientBucket`'s return turned both red. Pass 2's exact escape is closed. The `EXPECTED_HASH` was re-pinned by F132 and is consistent with HEAD. |
| AS-179 | PASS | minor | True in fact: `tsconfig.json` covers `components/portal/**`, `npx tsc --noEmit` exits 0, and CI runs `npm run build` (`next build`). Unchanged from pass 2: there is still **no `it()` block for AS-179** despite AS-179 appearing in the `describe` title at :39. The assertion is satisfied by the typecheck/build gate, not by the M9 suite — the title overstates coverage. Cosmetic, not blocking. |
| AS-180 | PASS | — | `m9-regression.test.ts:138-166`. Positive assertions added for `COMPONENT_COLUMNS`: `.toContain("name")` and `.toContain("position")` (:156-157), alongside the existing `page_kind`/`page_slug` positives and the `description` negative. **Mutation-proven, executed:** `COMPONENT_COLUMNS = "id"` — pass 2's exact escape, which silently stripped component names and ordering from the board — now turns AS-180 **red**. Residual nit (carried, not blocking): the extraction regex requires a double-quoted literal, so reformatting to a template literal breaks the test fail-safe. |
| AS-181 | PASS | — | The tree-wide `setNodeMetaClientVisibility` scan is unchanged and still sound, and the **dropped-column half is now implemented** (:200-229): a `grep -r client_visible` over `app/ components/ lib/`, excluding tests and `database.types.ts`, then qualified per-file by co-occurrence with `architecture_node_meta` — correctly avoiding false positives on the live `page_components.client_visible` / `sections.client_visible` columns. **Mutation-proven, executed:** adding a line referencing both `architecture_node_meta` and `client_visible` to `lib/queries/architecture-details.ts` turned AS-181 **red** with the intended message. The qualification is file-scoped rather than statement-scoped, so a file that legitimately touches both would false-positive; that is fail-safe and no such file exists today. |
| AS-182 | PASS | — | Unchanged from pass 2, where it was mutation-proven three ways (`EXPECTED_ACTION_COUNT = 25` hand-verified; an unused barrel export trips both guards; comment/string-only mentions do not satisfy the call-site guard). Re-run green. |

**Score: 10 PASS / 0 FAIL.** 0 blockers, 0 majors, 5 minors.
AS-170, AS-171, AS-174 deferred and not scored.

Working tree verified clean of all mutation edits after the battery
(`git status --porcelain` shows only mission markdown and untracked
`.playwright-mcp` artefacts; no `lib/`, `components/`, `supabase/` or `tests/`
modifications remain).

## Recommended follow-up features

None are blocking. The following are quality items the orchestrator may schedule
at its discretion, plus the three deferred assertions that still need a home.

**FU-14 — Align the `lint` npm script with CI (minor, carried from FU-13).**
`package.json` still defines `"lint": "eslint"` with no `--max-warnings=0`, while
`.github/workflows/ci.yml:54,138` runs the strict form. The tree is clean today,
so both exit 0 and AS-006 is genuinely satisfied — but the local script will
silently accept the next warning that lands while CI rejects it, which is exactly
the drift that produced pass 2's AS-006 caveat. Change the script to
`eslint . --max-warnings=0` so the loose form cannot be reintroduced. Related and
also unresolved: `npm test` is an unscoped `vitest run` that is red against an
unreachable Supabase, while CI and this gate scope to `tests/unit`; add an
explicit `test:unit` / `test:integration` split so "the suite passes" has one
unambiguous meaning rather than depending on which command the reader runs.

**FU-15 — Give AS-179 a test or strike it from the describe title (minor).**
`m9-regression.test.ts:39` advertises AS-179 in its `describe` title but contains
no `it()` block for it. The assertion is in fact satisfied by `tsc --noEmit` and
`next build`, so nothing is broken — but a green M9 suite is zero evidence for
AS-179, and a future reader will reasonably assume otherwise. Either add a test
that asserts `components/portal/**` is inside the `tsconfig.json` include set and
outside its exclude set (so a future tsconfig narrowing is caught at the M9 layer
rather than silently removing portal files from the typecheck), or rename the
describe block to list only the assertions it actually exercises.

**FU-16 — Make AS-168's content floor relevance-based rather than length-based (minor).**
The header check now correctly anchors to line 1, but "explains why it exists and
what it changes" is approximated by a 20-character length gate. A migration whose
header reads `-- misc cleanup after the refactor` passes while saying nothing
about the DDL below it. Parse the table and column identifiers out of the
migration body and require the leading comment block to mention at least one of
them. This is a small, self-contained improvement and the only remaining gap
between AS-168's text and its test.

**FU-17 — Enforce AS-170, AS-171 and AS-174 in CI (deferred, carried from FU-12).**
Recorded here so the deferral stays visible rather than dissolving. All three
assertions rest on manual runs recorded in handoffs, and AS-171's run never
succeeded (`LegacyImagePrepullError`, no Docker; a `db:gen-types` byte-identity
proxy was substituted). When Docker/CI infrastructure becomes available, add a CI
job that runs `npm run migrations:check` (the script exists and the `ci` job
already holds the credentials) and runs `npm run db:gen-types` into a temp file,
diffing it against the committed `lib/supabase/database.types.ts` and failing on
any difference. That diff is the single highest-value missing check in this
mission: it subsumes AS-174 and removes the freshness premise that AS-172 and
AS-173 currently rest on. For AS-171, either provision Docker so
`supabase db diff --use-migra` genuinely runs, or amend the assertion to name the
types-diff proxy as the accepted verification method — do not leave a PASS
resting on an error.

---

# Appendix — full gate output

## `npx tsc --noEmit`
```
exit 0 (no output)
```

## `npx eslint . --max-warnings=0` (the strict form CI runs)
```
exit 0 (no output)
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
      Tests  3340 passed | 3 skipped (3343)
   Duration  83.22s (transform 5.98s, setup 60.39s, import 101.65s, tests 57.09s, environment 68.71s)
exit 0
```

## Mutation battery (all executed, all reverted)

| # | Mutation | Expected | Observed |
|---|---|---|---|
| M1 | `supabase/migrations/20261127145000_zz_throwaway.sql` with bare `--` header | AS-168 red | **red** — `1 failed \| 1 passed` |
| M2 | `supabase/migrations/20261127145000_zz_add.sql`, `ADD COLUMN`, dated after both drops | AS-169 red | **red** — `1 failed \| 1 passed` |
| M3 | `CATEGORY_BUCKET_FALLBACK.not_started`: `"progress"` → `"waiting"` | AS-178 red | **red** — AS-178 *and* AS-178b, `2 failed \| 2 passed` |
| M4 | `isClientBucket` return inverted | AS-178 red | **red** — `2 failed \| 2 passed` |
| M5 | `COMPONENT_COLUMNS = "id"` (drops `name`, `position`) | AS-180 red | **red** — `1 failed \| 3 passed` |
| M6 | `architecture_node_meta` + `client_visible` reference added to `lib/queries/architecture-details.ts` | AS-181 red | **red** — `Files reference dropped column architecture_node_meta.client_visible: lib/queries/architecture-details.ts` |

Post-battery tree check: `git status --porcelain` clean of all `lib/`,
`components/`, `supabase/` and `tests/` modifications.
