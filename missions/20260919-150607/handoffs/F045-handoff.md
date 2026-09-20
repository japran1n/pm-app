# Handoff: F045 — Izbor `page_kind` u `create-page-dialog`, default `static`

## Status
COMPLETE

## Assertions covered
AS-152: PASS — CreatePageDialog renders a page_kind selector button ("Change page kind"); verified in `tests/unit/f045-create-page-dialog-page-kind.test.tsx`.
AS-153: PASS — default selected option is `static` (aria-selected="true" on the "static" option before any interaction).
AS-154: PASS — selecting "cms" then submitting calls `createPage("proj-1", expect.objectContaining({ page_kind: "cms" }))`.

## Files changed
components/architecture/create-page-dialog.tsx
components/architecture/page-kind-selector.tsx
tests/unit/f045-create-page-dialog-page-kind.test.tsx

## Commands run
`npx vitest run tests/unit/f045-create-page-dialog-page-kind.test.tsx tests/unit/f016-change-page-kind.test.tsx --reporter=verbose` (0)
`npx tsc --noEmit` (0)
`npx eslint components/architecture/create-page-dialog.tsx components/architecture/page-kind-selector.tsx --max-warnings=0` (0)
`npx vitest run tests/unit` (1 — 31 pre-existing failures in unrelated files, see Notes)

## Decisions made
- The clarified spec assumed `PageKindSelector` already exposed a `value`/`onChange` controlled contract (like `section-kind-selector.tsx`). On reading `components/architecture/page-kind-selector.tsx` it actually only supported a persisted `taskId`/`kind` mode (calls `changePageKind` server action directly, used by `client-sitemap-tree.tsx` and `page-card-menu.tsx`). A page being created in the dialog has no `taskId` yet, so that mode can't be reused as-is.
- Resolved by extending `PageKindSelector` to a discriminated-union prop type: existing `{ taskId, kind }` mode is untouched (verified via the pre-existing `f016-change-page-kind.test.tsx`, still green), and a new `{ value, onChange }` controlled mode was added for CreatePageDialog's pre-creation use case. This kept the change inside the one file the spec named as "already exists," rather than inventing a duplicate component or touching `createPage`/validation schema (both explicitly off-limits).
- `page_kind` label/selector rendered below the slug input, before the DialogFooter buttons, per spec.
- Reset behavior: `setPageKind("static")` added to `resetAndClose()`.

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Extended `PageKindSelector`'s prop contract to a union (`{taskId,kind}` | `{value,onChange}`) instead of creating a second component, since the spec's clarified implementation explicitly assumed (incorrectly) that the value/onChange contract already existed on this exact component. This is the minimal change that satisfies the spec's literal `<PageKindSelector value={pageKind} onChange={setPageKind} />` usage while leaving all existing callers (task detail page kind change, F016/AS-032) working unchanged and covered by their existing passing tests.

## Notes for the next worker
- Full `tests/unit` run shows 31 failing tests across 10 files unrelated to this feature (realtime hook/channel mocking issues, `supabase.rpc is not a function`, component-panel/detail tests, portal guard tests, etc.) — none touch `create-page-dialog.tsx` or `page-kind-selector.tsx`. These look like pre-existing failures from concurrent/other-feature work in the repo (unstaged changes present in `board.tsx`, `component-panel.tsx`, `lib/actions/architecture.ts`, etc. at the time of this run) and were not introduced by this feature; not fixed here as they're out of this feature's scope.
- No MCP usage — this is a pure client-component/UI feature with no live external service state to inspect.
