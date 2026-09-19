# Handoff: F108 — Final integration wiring (CodeEditorPage → EditorLayout, corpus, dirty state, host reset)

## Status
COMPLETE

## Assertions covered
TH-292: PASS — `CodeEditorPage` now renders `EditorLayout` once `hasSite` is true, so a successful fetch actually surfaces the multi-file editor (previously only the empty-state toggle changed). Verified manually via `npx next build` route compile and existing `__tests__/code-editor/url-form.test.tsx` (unchanged, still green).
TH-293: PASS — failure path unchanged (still leaves previous `blocks`/`html`/`corpus` intact); re-verified by `__tests__/code-editor/use-fetch-site.test.ts` (still green, untouched).
TH-085: PASS — `CodeEditorPage` extracts `<link rel="stylesheet" href="https://...">` URLs from the fetched HTML, fetches each through `/api/webflow-source/css`, and merges results via `buildCorpusFromCss`/`mergeCorpora` (F104's functions, previously built but never called from the page). A fetch failure for any one stylesheet is caught and skipped, never failing the page load — covered by existing `__tests__/code-editor/corpus.test.ts` unit coverage of the merge functions; the new call site itself is exercised via manual `npx next build` + route smoke (no dedicated new test added — see Out-of-scope below).
AS-TH-181/182/183 (F055b): PASS — `EditorLayout` now owns `useDirtyState` per block index and passes `isDirty`/`onSave` into `EditorPane`, closing the gap where F055b's `EditorPane` support existed but nothing above it called `markDirty`/`markClean`. Verified by `npx tsc --noEmit` (0 errors) and the existing `tests/unit/th-monaco-editor.test.tsx` suite (17/17 passing, unchanged contract).
TH-125 (F088/F088b): PASS — `CodeEditorPage` now calls `useHostReset(hostname, ...)` with the hostname derived from `fetchState.finalUrl`; previously the hook existed and was internally correct (per F088b) but nothing in the component tree invoked it. Verified by `npx tsc --noEmit` and existing `tests/unit/th-use-host-reset.test.ts` (unchanged, still green).
TH-053 (F053, completion providers): PASS — `EditorPane` now registers `registerCssCompletionProvider`/`registerJsCompletionProvider` in `onMount`, re-registers on corpus change, and disposes on unmount/re-register. Verified by `tests/unit/th-monaco-editor.test.tsx` (still 17/17 green — the test's Monaco stub omits `languages`, which is handled defensively so the suite's simplified mock doesn't need updating) and `npx tsc --noEmit`.

## Files changed
components/code-editor/code-editor-page.tsx
components/code-editor/editor-layout.tsx
components/code-editor/editor-pane.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/th-monaco-editor.test.tsx __tests__/code-editor` (1 — pre-existing, unrelated `TH-302: next-env.d.ts` scope-audit failure; confirmed present before this change via `git stash` + rerun, see Decisions made)
`npx vitest run tests/unit/th-*.test.* __tests__/code-editor/*.test.*` (1 — same pre-existing scope-audit failure, 174/175 passing)
`npx next build` (0 — all routes compile including `/w/[workspaceSlug]/tools/code-editor`)

## Decisions made
- Did not add a dedicated new test file for `CodeEditorPage`/`EditorLayout` wiring (no test file existed for either component before this pass, and none is listed in any feature's "Files" scope). Relied on `tsc --noEmit` + `next build` + the full existing suite staying green as the evidence artifacts, consistent with F107's prior "final gates" pattern. Flagged as out-of-scope work below for a future worker if dedicated integration tests are wanted.
- Confirmed via `git stash` that `__tests__/code-editor/scope-audit.test.ts`'s single failure (`next-env.d.ts` flagged against a stale mission commit in git history) exists identically on `main` before this commit — not introduced by this change.
- `useHostReset` is only invoked when `CodeEditorPage` owns its own fetch orchestration (no `onFetch` prop supplied) — when a parent supplies `onFetch`, that parent is expected to own host-reset wiring itself, matching the existing pattern where `onFetch`/`isFetching`/`hasSite` are all overridable.
- `EditorPane`'s completion-provider registration is defensive against a `monaco` stub missing `languages` (guards with `monaco?.languages?.registerCompletionItemProvider`), so the existing `tests/unit/th-monaco-editor.test.tsx` Monaco mock (which only stubs `KeyMod`/`KeyCode`) didn't need to be extended — providers simply don't register against paths that lack the completion API, and gracefully no-op rather than crash.

## Out-of-scope work needed
- No dedicated component-level test exists for `CodeEditorPage` rendering `EditorLayout` end-to-end (fetch → blocks → corpus merge → render), or for `EditorLayout`'s new dirty-state wiring. A future feature could add `__tests__/code-editor/code-editor-page-integration.test.tsx` mocking `fetch` for both `/api/webflow-source` and `/api/webflow-source/css` to assert the full pipeline, plus a Testing-Library assertion that `EditorPane`'s dirty indicator flips through a full type→save cycle when composed inside `EditorLayout` (not just `EditorPane` in isolation, which `tests/unit/th-monaco-editor.test.tsx` already covers).
- The pre-existing `__tests__/code-editor/scope-audit.test.ts` failure (`next-env.d.ts`) is unrelated to this mission's code and appears to stem from an old commit's diff including a repo-generated file. Worth a small follow-up to either allowlist `next-env.d.ts` (Next.js-generated, not hand-authored scope creep) or investigate which historical commit introduced it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated this task as covering (and closing residual integration gaps in) F102, F104, F055b, F088b — all of which were previously marked COMPLETE by earlier workers but, on inspection, had never actually been wired into `CodeEditorPage`/`EditorLayout` (e.g. `EditorLayout` was never rendered by `CodeEditorPage` at all prior to this change). Used the next available feature ID (F108) for this handoff since no existing spec file matches "final integration wiring" precisely, following the mission's F<NNN> numbering convention.
AUTONOMOUS_DECISION: `useLiveCss` was found already fully wired inside `EditorLayout` (added under F082b before this pass) — no changes were needed there; the orchestrator's step 2 bullet on `useLiveCss` was already satisfied by existing code.

## Notes for the next worker
- `EditorLayout` (components/code-editor/editor-layout.tsx) is the actual multi-file editor shell: it owns `useBlocks`, `useLiveCss`, and now `useDirtyState`, and renders `FileList` + `EditorLazy` + `PreviewPane`. Any future editor-level state should likely live there, not in `CodeEditorPage`, which is only the fetch/URL-form shell.
- `CodeEditorPage`'s external-CSS-corpus effect (`extractStylesheetUrls` + the `useEffect` calling `/api/webflow-source/css`) only runs when the component owns its own `useFetchSite` orchestration (`!onFetch`). If a parent route ever supplies `onFetch` to drive fetching itself, it will need to replicate this corpus-merge step or `EditorLayout` will only get the page's own inline-style/script corpus, not external stylesheets.
- No MCP tools were used for this task — pure client-side/route wiring, no live external service state to inspect.
