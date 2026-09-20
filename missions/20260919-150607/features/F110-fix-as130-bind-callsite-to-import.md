# F110 — Fix AS-130: bind call-site to verified architecture import

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-2 FU-1 blocker)_

## Problem

`hasRealReference` in `tests/unit/m6-action-barrel-guard.test.ts` passes when ANY file
has `NAME(` — including an unrelated module defining a same-named method. The exploit:
strip every occurrence of `createPage` from its real consumer, add a fixture/helper
with `createPage()` method — guard stays GREEN.

## Fix

Rework `hasRealReference` so an action counts as referenced ONLY when a SINGLE file:
(a) imports it by name from a specifier resolving to the architecture actions barrel
    (`@/lib/actions/architecture` or `lib/actions/architecture`) or one of its leaf modules
    under `lib/actions/architecture/` — OR namespace-imports that module
(b) AND contains a call or value reference to that imported binding

Regex tightening: use `(?<![.\w$])NAME\s*\(` so member access on an unrelated object
cannot satisfy the call check.

Additionally restrict `collectFiles` scope to only: `app/`, `components/`, `lib/`
(excluding `tests/`, `missions/`, `scripts/`, `extension/` etc.) — 
test helpers in `tests/` should not count as "real references".

## Acceptance test (mutation proof required)

Reproduce the exploit from scrutiny-2:
1. Strip every occurrence of one action (e.g. `createPage`) from its sole real consumer
   (`components/architecture/create-page-dialog.tsx` or wherever it's imported)
2. Create a temp file `tests/helpers/fake-actions.ts` with:
   ```ts
   export const t = { createPage() {} };
   t.createPage();
   ```
3. Run: `npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`
4. Guard must FAIL naming `createPage` (despite the same-named method in tests/)
5. Revert both changes: `git checkout -- <consumer file>` + delete temp file
6. Test must pass again

## Assertion: AS-130

Commit: `feat(F110): fix AS-130 bind call-site to verified architecture import`

Handoff: `missions/20260919-150607/handoffs/F110-handoff.md`
Must include mutation proof output showing FAIL despite same-named method in tests/.
