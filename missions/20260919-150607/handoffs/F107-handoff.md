# Handoff: F107 — Fix AS-130: barrel guard import/call detection only

## Status
COMPLETE

## Assertions covered
AS-130: PASS — `npx vitest run tests/unit/m6-action-barrel-guard.test.ts` passes; mutation proof (below) confirms the test goes RED when a real call site is removed while a comment mentioning the same name is left intact.

## Files changed
tests/unit/m6-action-barrel-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, both tests pass)
`npx vitest run` (0 — 206 pre-existing failures unrelated to this change, all in unrelated files with `supabase.rpc is not a function` mock issues; confirmed via `git status --short` that only `tests/unit/m6-action-barrel-guard.test.ts` was modified)
`git diff components/architecture/page-kind-selector.tsx` (0, empty — confirms clean revert after mutation test)

## Decisions made
- Split stripping into `stripComments` (comments only) and `stripCommentsAndStrings` (comments + string literals). Import-specifier detection uses the comment-only-stripped source (so the quoted module path like `"@/lib/actions/architecture"` survives), while call-site detection (`actionName(`) uses the comment+string-stripped source (so a call-shaped mention inside a string/comment doesn't count). Stripping strings before scanning for import quotes replaces the quoted path with `""`, which would break all import detection — this bug was caught during implementation via a failing `importPages` case and fixed by not string-stripping content used for import-path matching.
- Import detection matches specifier paths containing `lib/actions/architecture` (covers both the barrel `lib/actions/architecture.ts` and leaf modules `lib/actions/architecture/*`), so re-exports through either surface count as real usage, matching AS-134's "no allowlist" requirement.
- `EXPECTED_ACTION_COUNT` hard-coded to 23, the actual count of value exports in `lib/actions/architecture.ts` at time of writing (determined by running the test and reading the actual parsed count, not by manual counting of the source, to avoid off-by-one errors from multi-line export blocks).
- Added an `export *` guard via `expect.fail(...)` inside `parseBarrelExports`, per spec, even though the current barrel does not use `export *`.

## Out-of-scope work needed
None identified for this feature. The pre-existing ~206 failing tests across the suite (Supabase client mock returning an object without `.rpc`) are unrelated to the barrel guard and were not touched; if the mission wants those fixed, a separate feature should be filed (e.g. "fix Supabase test client mock to include `.rpc`").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to strip comments and strings into two separate derived strings per file (rather than one single stripped string) because fully stripping strings before import-path matching breaks detection of the import's module specifier (quoted string). This wasn't explicitly covered in the spec's sample code, but was required to correctly detect real references like `importPages`, which is imported via `import { importPages } from "@/lib/actions/architecture";` in `components/architecture/sitemap-io-dialog.tsx`.

## Notes for the next worker
Mutation proof output (FAIL) after removing `changePageKind`'s import and call site from `components/architecture/page-kind-selector.tsx`, while leaving the comment at `lib/validation/architecture.ts:63` (and the comment mentioning `changePageKind` in `page-kind-selector.tsx` itself) intact:

```
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses the expected number of exported actions from the barrel 1ms
 × tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 88ms
   → The following architecture action(s) exported from lib/actions/architecture.ts have no real import/call reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: changePageKind: expected [ 'changePageKind' ] to deeply equal []

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests
AssertionError: The following architecture action(s) exported from lib/actions/architecture.ts have no real import/call reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: changePageKind: expected [ 'changePageKind' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "changePageKind",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

After reverting (`git checkout -- components/architecture/page-kind-selector.tsx`), `git diff` on that file was empty and the test suite for this file passed again (2/2).

No MCP tools were used — this is a pure test/tooling fix with no external service interaction.
