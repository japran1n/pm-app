# Handoff: F110 — Fix AS-130: bind call-site to verified architecture import

## Status
COMPLETE

## Assertions covered
AS-130: PASS — `npx vitest run tests/unit/m6-action-barrel-guard.test.ts` passes; mutation proof below confirms the guard now fails when the sole real consumer of an action is stripped, even when a same-named method exists in `tests/`.

## Files changed
tests/unit/m6-action-barrel-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, after fix)
`npx vitest run` (0 exit — but see note below: 263 pre-existing failing test files unrelated to this change, e.g. `supabase.rpc is not a function`, `getSession` on undefined client in unrelated Supabase-mocked tests. These failures exist on `main` before this change and are out of scope for F110.)
`git status` (0, clean after mutation-proof cleanup)

## Decisions made
- Reworked `hasRealReference(commentOnlyStrippedContent, callSiteContent, actionName)` to require BOTH conditions in the SAME file: (a) a named import of `actionName` from a specifier matching `lib/actions/architecture`, or a namespace import (`import * as X from ".../lib/actions/architecture..."`) followed by `X.actionName(`; AND (b) a call site `(?<![.\w$])actionName\s*\(` (or `X.actionName(` for namespace imports) in that same file's comment/string-stripped content. Previously the two checks were OR'd across the whole file set, so an import-only reference or an unrelated same-named call anywhere sufficed — the exploit the spec describes.
- Restricted `collectFiles` scanning via a new `collectScannableFiles(root)` that only walks `app/`, `components/`, `lib/` — matches the spec's explicit exclusion list (`tests/`, `missions/`, `scripts/`, `extension/`, root-level files).
- Rewrote `stripComments`/`stripCommentsAndStrings` from three independent regexes into a single left-to-right, context-aware scanner (`scanSource`). This was **not explicitly requested by the spec** but was required to make the tightened AND-logic pass on the *unmodified* codebase: the old regex-based comment stripper treated `//` inside a string literal (e.g. `useState("https://example.com")` in `components/architecture/sitemap-io-dialog.tsx`) as a line-comment start, truncating the string and eating its closing quote. That corrupted all subsequent quote/backtick pairing in the file and silently deleted the real `importPages(` call site, causing a false-positive "unused action" failure that has nothing to do with the actual exploit. The new scanner tracks line-comment / block-comment / string-quote state together in one pass so `//` inside a string is never misread as a comment, and different quote types nest correctly without contraction-apostrophe corruption (a related latent bug in the original single-quote regex).
- `stripComments` (keepStrings=true) is still used where the caller needs the quoted specifier to survive (barrel export parsing); `stripCommentsAndStrings` (keepStrings=false) is used for real call-site detection.

## Out-of-scope work needed
- The full `npx vitest run` suite has ~263 pre-existing failing test files unrelated to this feature (Supabase client mocking gaps: `supabase.rpc is not a function`, `.auth.getSession()` on undefined, etc.). These predate this change and are outside F110's scope — a separate feature should address the Supabase test-mocking setup if it's blocking CI.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Rewrote the comment/string stripper as a unified scanner rather than patching the three regexes individually, because the exposed bug (a URL's `//` truncating a string) could recur in any file with a URL literal, and the spec's mutation-proof requirement (guard must correctly detect the real call site while ignoring the tests/ helper) could not pass reliably otherwise on real source containing URLs.

## Notes for the next worker
Mutation proof (per spec):

1. Stripped `createPage` from `components/architecture/create-page-dialog.tsx` (renamed the import to `_unusedCreatePage` with `void _unusedCreatePage;`, and replaced the `await createPage(projectId, {...})` call with a stub that never references `createPage`).
2. Created `tests/helpers/fake-actions.ts`:
   ```ts
   export const fakeActions = { createPage() { return null; } };
   fakeActions.createPage();
   ```
3. Ran `npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`. Result:
   ```
   × tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 472ms
     → The following architecture action(s) exported from lib/actions/architecture.ts have no real import/call reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: createPage: expected [ 'createPage' ] to deeply equal []

   AssertionError: ... createPage: expected [ 'createPage' ] to deeply equal []
   ```
   Guard correctly FAILS naming `createPage`, despite `tests/helpers/fake-actions.ts` defining and calling a same-named method (which is excluded both by the `app/components/lib`-only scan and by requiring the import+call pairing in one file).
4. Reverted: `git checkout -- components/architecture/create-page-dialog.tsx`; deleted `tests/helpers/fake-actions.ts` (and the now-empty `tests/helpers/` dir).
5. Re-ran the test: 2 passed, 0 failed.
6. `git status` confirmed clean (no leftover mutation artifacts) before committing.

Gotcha for future workers touching this guard: any new action's sole call site living inside a file with a URL string literal (or other `//`-containing string) will only be found correctly because of the `scanSource` rewrite — do not revert to independent regex-based comment/string stripping.
