# Handoff: F056 — sitemap byte identity fix (hasCmsSections)

## Status
COMPLETE

## Assertions covered
AS-038: PASS — non-CMS page JSON output is byte-identical to pre-F009 shape (no `hasCmsSections` key present at all); verified with a direct `JSON.stringify` equality assertion in `tests/unit/sitemap-io.test.ts`.

## Files changed
lib/architecture/sitemap-io.ts
tests/unit/sitemap-io.test.ts

## Commands run
`npx vitest run tests/unit/sitemap-io.test.ts` (0) — 29/29 passed
`npx tsc --noEmit` (0)
`npm run test` (nonzero overall — see Decisions made; sitemap-io suite itself passed)

## Decisions made
- Changed `SitemapJson.pages[].hasCmsSections` from `boolean` to optional `true`, and changed `toJson` to spread `{ hasCmsSections: true }` only when `page.sections.some(s => s.kind === "cms")` is true, emitting no key at all otherwise. This makes non-CMS page JSON byte-identical to the pre-F009 shape, satisfying AS-038 literally instead of redefining "byte-identical" to tolerate an extra field.
- Rewrote the AS-038 test to do a direct `JSON.stringify` comparison against a fixture object that has no `hasCmsSections` key, plus an explicit `not.toHaveProperty("hasCmsSections")` check per page — removing the old "modulo the new field" key-set comparison.
- Updated AS-036 and AS-037 tests (previously asserted `hasCmsSections` was always present as a boolean) to assert the key is present only when true and absent (`undefined`) otherwise, consistent with the new contract. These are directly downstream of the same fix and were the tests that had encoded the wrong (always-boolean) contract.
- Verified AS-037 still holds: a page with a `kind: "cms"` section gets `hasCmsSections: true` explicitly asserted in the AS-037 test.
- Verified AS-039 (markdown export unchanged) — that test was already correct and untouched; reran it to confirm it still passes.
- Ran the full repo test suite (`npm run test`) for due diligence. 5 unrelated test files fail (`tests/unit/f039-portal-guards.test.ts`, `__tests__/code-editor/scope-audit.test.ts`, `tests/unit/watching-feed-query.test.ts`, `__tests__/api/webflow-css-route.test.ts`, `tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx`). Confirmed via `git stash` that these same 5 files fail identically on the pre-existing working tree before my change (missing `supabase.rpc`, DB migration seed conflicts, scope-audit drift, etc.) — they are pre-existing environment/DB-state issues unrelated to sitemap-io and outside this feature's scope. `tests/unit/sitemap-io.test.ts` passes 29/29 both before and after my change (before: with the old, wrong AS-038 test; after: with the corrected one).

## Out-of-scope work needed
The 5 pre-existing failing test files noted above are unrelated to F056 and were already broken before this change (confirmed via `git stash`). They look environment/DB-state related (e.g. `supabase.rpc is not a function`, a duplicate-key migration seed error, and scope-audit files that changed on disk outside this feature). Someone should investigate those separately; not done here per scope restriction to `lib/architecture/sitemap-io.ts` and its test file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `hasCmsSections?: true` (optional literal-true) rather than `hasCmsSections?: boolean` in the `SitemapJson` type, since the field is now only ever emitted as `true` — this matches the "no key at all when false" contract exactly and makes the previous `boolean` typing (which implied `false` was a valid emitted value) explicitly wrong going forward.

## Notes for the next worker
- The core fix is a one-line change to `toJson` in `lib/architecture/sitemap-io.ts`: `...(page.sections.some(s => s.kind === "cms") ? { hasCmsSections: true as const } : {})`.
- No MCP tools were needed for this fix — it's pure application logic in the repo with no live external service state involved.
- If `npm run test` is ever used as a hard gate for this feature, note the 5 pre-existing unrelated failures documented above; they are not caused by or fixed by this change.
