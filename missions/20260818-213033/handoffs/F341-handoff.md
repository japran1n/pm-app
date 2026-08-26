# Handoff: F341 — carry element position and size into the report (M19 scrutiny BLOCKER-1)

## Status
COMPLETE

## Assertions covered
AS-547: PASS — new test `AS_547_submitted_description_contains_selector_and_position_and_size` in `extension/tests/describe.spec.ts` asserts the actual submitted description string (buildTaskDescription's return value, which IS the string report-form.tsx sends as `description` to `POST /api/extension/tasks`) contains the selector AND `Position:`/`Size:` lines. Verified with `npx playwright test tests/describe.spec.ts tests/element-picker-selector.spec.ts` — 16/16 pass.

## Files changed
extension/src/submit/describe.ts
extension/src/popup/report-form.tsx
extension/src/capture/element-picker.ts
extension/src/capture/selector.ts
extension/tests/describe.spec.ts

## Commands run
`cd extension && npm run typecheck` (0)
`cd extension && npm run lint` (1 — pre-existing `vite.config.ts:82 'process' is not defined` error, introduced by a concurrent worker's in-progress edit to `vite.config.ts`, which I did not touch and is out of my file scope per instructions)
`cd extension && npm run build` (0)
`cd extension && npx playwright test tests/describe.spec.ts tests/element-picker-selector.spec.ts` (0 — 16/16 passed)
`cd extension && npx playwright test` (0 process exit, 81 passed / 1 failed — the 1 failure, `AS_571_...distributable_artifact` in `build-and-packaging.spec.ts`, is about icon paths in the built zip and is caused by a concurrent worker's in-progress `vite.config.ts`/`manifest.json` changes for FU-4; it is unrelated to any file I touched and predates/postdates my commit independent of my diff)
`npx tsc --noEmit` (repo root, 0)
`npx eslint .` (repo root, 0 errors, 6 pre-existing warnings — identical set to M19-scrutiny.md's baseline)

## Decisions made
- Reused the exact rect shape `element-picker.ts:248` already produces (`{ x, y, width, height }` from `getBoundingClientRect()`) for `DescribeElement.rect`, per the mission's explicit instruction — no new shape invented.
- Rendered position/size as two separate readable lines (`Position: x, y` / `Size: width x height`) alongside `Selector:`, matching the existing line style in `buildTaskDescription`'s `Environment:` section (`  Key: value`).
- Fixed the test gap by rewriting/adding tests in `extension/tests/describe.spec.ts` (the file that already tests `buildTaskDescription` — the actual assembly function whose output becomes the submitted description) rather than only patching `element-picker-selector.spec.ts`, since the latter is scoped to testing the picker's own return value by design (its own file header says so) and is not the right place to prove the value reaches the submission. The new `AS_547_...` test follows the value into the submitted string, exactly as BLOCKER-1/FU-2 specify.
- MIN-5 (data-* PII leak): judged small and safe, fixed it. Restricted the fallback in both `selector.ts` (the tested/canonical copy) and `element-picker.ts`'s in-page duplicate (the copy that actually ships and runs in production, per MIN-4's note that these two must be kept in lock-step) to an allowlist of `data-testid`, `data-test`, `data-cy`, `data-qa`. Verified via `grep` that this codebase's own convention (`app/`, `components/`, `lib/`) uses only `data-testid`, so the allowlist is a superset covering common cross-framework equivalents without inventing an untested convention. Confirmed no existing test in `element-picker-selector.spec.ts` relies on any other `data-*` attribute name (only `data-testid` appears), so this is a non-breaking restriction.

## Out-of-scope work needed
- FU-1 (AS-548, BLOCKER-2): environment metadata capturing the popup's own URL/viewport instead of the page's — a different worker is already editing `environment.ts` concurrently for this; not touched here.
- FU-4 (AS-571, BLOCKER-5): manifest hardcoded to localhost — a different worker is already editing `vite.config.ts`/`manifest.json` concurrently for this; not touched here. Its in-progress state currently causes 1 unrelated Playwright failure (`build-and-packaging.spec.ts`), pre-existing to my change and not something I should intervene on per the "avoid touching" instruction.
- FU-3 (AS-557, BLOCKER-4), FU-5 (bookkeeping), FU-6 (AS-563), FU-7 (AS-532/535/545) — all untouched, out of this feature's scope.
- MIN-4 (the hand-duplicated selector algorithm between `selector.ts` and `element-picker.ts`) remains a duplication risk in general; I kept both copies manually in sync for this specific change (the allowlist) but did not resolve the underlying duplication itself — that is a larger refactor out of scope for this fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to fix MIN-5 in-scope (both copies of the selector algorithm) since it was small, safe, and directly adjacent to the file I was already editing for the primary fix, per the mission's explicit "use your judgment" instruction.

## Notes for the next worker
- `describe.ts`'s file header explicitly documents that its output IS the submitted description string sent to `POST /api/extension/tasks` — that's why testing `buildTaskDescription`'s return value (rather than instrumenting the live `fetch` call in `report-form.tsx`) is a faithful "follow the value to submission" test, not another instance of testing-the-boundary-the-implementation-draws.
- Other workers are concurrently touching `extension/src/popup/environment.ts`, `extension/manifest.json`, `extension/vite.config.ts`, `extension/.env.example`, `extension/eslint.config.mjs`, `extension/tests/permissions-minimisation.spec.ts`, and there's a new untracked `extension/src/capture/page-context.ts` — all left untouched and unstaged by me, exactly as instructed. The orchestrator should let those workers commit their own files independently.
