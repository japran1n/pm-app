# Handoff: F039 — Guards fail the build (mutation proof, no allowlist)

## Status
COMPLETE

## Assertions covered
AS-131: PASS — mutated `pageKindEnum` in `lib/validation/architecture.ts` (added `"fake_kind_xyz"`), ran `npx vitest run tests/unit/m6-check-value-guard.test.ts`, confirmed 2/4 tests FAIL (AS-126, AS-127) with a clear diff showing the extra enum value. Reverted via `git checkout --` and confirmed `git diff` is empty.
AS-134: PASS — confirmed via `grep -n "guard-ignore|allowlist|skip"` across both guard test files that no allowlist/skip/`@guard-ignore` mechanism exists (`NONE FOUND`). Both guards run unconditionally over every enum value / every exported action.

## Files changed
(none — this feature produces evidence only; both mutations were fully reverted before commit)

## Commands run
`npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts` (0, baseline green, 6/6 passed)
`sed -i '' 's/.../.../' lib/validation/architecture.ts` (mutation 1, no exit code relevant)
`npx vitest run tests/unit/m6-check-value-guard.test.ts --reporter=verbose` (1, 2/4 tests FAIL as expected — see Mutation proof below)
`git checkout -- lib/validation/architecture.ts` (0)
`git diff lib/validation/architecture.ts` (0, empty output — revert confirmed)
`sed -i '' 's/importPages/REMOVED_FOR_MUTATION_TEST/g' components/architecture/sitemap-io-dialog.tsx` (mutation 2, no exit code relevant)
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (1, 1/2 tests FAIL as expected — see Mutation proof below)
`git checkout -- components/architecture/sitemap-io-dialog.tsx` (0)
`git diff components/architecture/sitemap-io-dialog.tsx` (0, empty output — revert confirmed)
`npx vitest run tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, final green run, 6/6 passed)
`grep -n "guard-ignore\|allowlist\|skip" tests/unit/m6-check-value-guard.test.ts tests/unit/m6-action-barrel-guard.test.ts` (1, NONE FOUND — no allowlist)

## Decisions made

- **Experiment 1 (CHECK guard):** Added a fake enum value `"fake_kind_xyz"` to `pageKindEnum` in `lib/validation/architecture.ts` exactly as the spec's example suggested. This is a clean, minimal drift injection since `pageKindEnum` has no downstream side effects when read-only.

- **Experiment 2 (action barrel guard) — deviation from literal spec wording, documented:** The spec said "remove just that one import name from the import statement (keep file otherwise intact)." I first checked candidate files (`page-column-header.tsx` for `renamePage`, `component-panel.tsx` for `renameComponent`/`deleteComponent`) and found that the guard's `wordBoundaryRegex.test(content)` check scans the **entire file content, including doc comments**, and every one of these UI files has a doc-comment reference to its action name (e.g. `// Enter saves via \`renamePage\`...`). Removing only the `import` line therefore would NOT make the guard fail, because the action name would still be textually present in the file via the comment, and the guard would report it as "used." This is a real characteristic of the guard's implementation (text-search based, not AST-based), not a flaw in my methodology.

  To produce an honest mutation proof that the guard actually catches a real "no UI reference" violation, I selected `importPages` in `components/architecture/sitemap-io-dialog.tsx` — the only non-barrel, non-leaf, non-test file referencing that action — and removed **all** textual occurrences of `importPages` in that file (the import statement, the doc comment, and the call site) via a single `sed` substitution, replacing the identifier with a placeholder. This is the true "action has zero references anywhere outside the barrel" case the guard is designed to catch, and it triggered the expected FAIL naming `importPages` explicitly in the assertion message. I reverted immediately with `git checkout --` afterward.

  AUTONOMOUS_DECISION: Chose to fully clear all occurrences of the target action's identifier (not just the import statement) in Experiment 2, because the guard's real trigger condition is "zero references in file content," and a comment-only removal would have produced a false negative (test still green) that misrepresents the guard's actual coverage. This is a stronger and more honest proof of AS-131 (well, AS-130 mechanism underlying AS-134's "no allowlist / guards catch real violations" spirit) than the literal instruction would have produced.

## Out-of-scope work needed

- Noted but not acted on: the action-barrel guard (`m6-action-barrel-guard.test.ts`, AS-130) is text/regex-based and treats a bare mention of an action name inside a comment as "usage." This means a genuinely orphaned action (import removed, call removed, but a stale comment mentioning its name left behind) would slip past the guard undetected. This is a latent gap in the guard's precision, not something F039 was scoped to fix (F039 is proof-only, no guard-code changes allowed). A future feature could tighten the guard to only count real import/call-site usage (e.g. via a lightweight AST parse or an import-specific regex) if this false-negative mode is judged worth closing.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: For Experiment 2, removed all occurrences of the target action identifier in the chosen file (not just the import statement) because comment-only removal would not have triggered a FAIL given the guard's text-scan implementation, and a "prove the guard fails" experiment must actually exercise the guard's real trigger condition to be honest evidence. See Decisions made above for full detail and the specific comment-reference finding that necessitated this.

## Notes for the next worker

- Mutation 1 full output (from `tests/unit/m6-check-value-guard.test.ts --reporter=verbose` after mutating `pageKindEnum`):

```
 × tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-126: tasks_page_kind_check DB values match pageKindEnum exactly 12ms
   → expected Set{ 'static', 'cms', …(3) } to deeply equal Set{ 'static', 'cms', …(2) }
 × tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: pageKindEnum has no extra values beyond the DB CHECK constraint 6ms
   → expected false to be true // Object.is equality
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: tasks_section_kind_check DB values match sectionKindEnum exactly 6ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum has no extra values beyond the DB CHECK constraint 6ms

 FAIL  tests/unit/m6-check-value-guard.test.ts > ... AS-126 ...
AssertionError: expected Set{ 'static', 'cms', …(3) } to deeply equal Set{ 'static', 'cms', …(2) }
- Expected
+ Received
  Set {
    "cms",
    "cms_template",
+   "fake_kind_xyz",
    "static",
    "utility",
  }

 FAIL  tests/unit/m6-check-value-guard.test.ts > ... AS-127 ...
AssertionError: expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

- Mutation 2 full output (from `tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` after stripping all `importPages` references from `sitemap-io-dialog.tsx`):

```
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses at least one exported action from the barrel 1ms
 × tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one reference outside the barrel, leaf modules, and tests 54ms
   → The following architecture action(s) exported from lib/actions/architecture.ts have no reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: importPages: expected [ 'importPages' ] to deeply equal []

 FAIL  tests/unit/m6-action-barrel-guard.test.ts > ... every exported architecture action has at least one reference ...
AssertionError: ... have no reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: importPages: expected [ 'importPages' ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "importPages",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

- Revert confirmation for both experiments: `git diff <file>` produced empty output in both cases immediately after `git checkout --`.

- Final green run after both reverts (clean HEAD): `Test Files 2 passed (2)`, `Tests 6 passed (6)`.

- Allowlist check: `grep -n "guard-ignore\|allowlist\|skip"` across both guard test files returned no matches (`NONE FOUND`). Confirms AS-134 — no bypass mechanism exists in either guard.

- No files outside the handoff were modified or committed; both mutations were transient and fully reverted before this handoff was written. No MCP tools were needed for this feature (pure local test/mutation work, no external service state involved).
