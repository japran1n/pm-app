# Handoff: F331 — `npx next build` is broken; drive it to green

## Status
COMPLETE

## Assertions covered
No validation-contract assertion IDs are assigned to F331 (it is a build-infra
fix, not a feature spec with its own AS-NNN entries). Verified instead that no
existing assertion's test coverage regressed: full `tests/unit` suite (130
files / 1003 tests) and the two integration suites touched by this fix
(`tests/integration/purge-trash-item.test.ts`, AS-348/AS-349;
`tests/integration/f226-swimlane-collapse-persist.test.ts`, AS-422/AS-424)
all still pass.

## Files changed
lib/actions/purge.ts
lib/validation/purge.ts
lib/actions/board-prefs.ts
lib/validation/board-prefs.ts (new)
components/trash/purge-dialog.tsx
components/board/board.tsx
tests/integration/purge-trash-item.test.ts
tests/unit/f226-swimlane-collapse-persist.test.ts

## Commands run
`npx next build` (against a temporary `PM_APP_BUILD_DIST_DIR`-gated distDir override in next.config.ts, reverted before commit — see Decisions made) (0) — full production build succeeds, all 29 routes compiled
`npx tsc --noEmit` (0) — no output, clean
`npx eslint .` (0) — 2 pre-existing warnings (`lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186`, both `no-unused-vars` on `_`-prefixed intentionally-unused vars), 0 errors
`npx vitest run tests/unit` (0) — 130 files / 1003 tests passed (unchanged from the pre-existing baseline)
`npx vitest run tests/integration/purge-trash-item.test.ts` (0) — 6/6 passed
`npx vitest run tests/integration/f226-swimlane-collapse-persist.test.ts` (0) — 6/6 passed
`git checkout -- next.config.ts next-env.d.ts tsconfig.json` (0) — reverted the temporary build-verification distDir override and Next's auto-appended tsconfig/next-env includes after each build run

## Decisions made
- Root cause (both failures) was Turbopack's `"use server"` rule that a
  module may **only** export async functions
  (https://nextjs.org/docs/messages/invalid-use-server-value). Two files in
  the repo violated it with a `const` export:
  - `lib/actions/purge.ts`: `export const PURGE_CONFIRMATION_PHRASE = "DELETE";`
  - `lib/actions/board-prefs.ts`: `export const SWIMLANE_GROUP_BY_PREF_VALUES = [...]`
    plus its dependent Zod schema (`upsertSchema`, itself a value export) and
    several `export type`s that were fine on their own but sat in the same
    file, so once the file was flagged as invalid Turbopack treated the
    whole module (including its genuinely-async exports) as having no
    exports at all — this is why `getBoardSwimlanePrefs`/
    `upsertBoardSwimlanePrefs` became unresolvable to their importers even
    though the functions themselves were correctly `async`.
- Fix pattern (same for both): moved every non-async-function export
  (constants, derived types, Zod schemas) into a sibling `lib/validation/*`
  module that is NOT `"use server"`, and had the action file import them
  back. `lib/validation/purge.ts` already existed for this exact purpose
  and already held `purgeTrashItemSchema`, so `PURGE_CONFIRMATION_PHRASE`
  now lives there too. No `lib/validation/board-prefs.ts` existed, so I
  created one following the same shape (constant array, derived types,
  Zod schema) and left the two async functions
  (`getBoardSwimlanePrefs`, `upsertBoardSwimlanePrefs`) in
  `lib/actions/board-prefs.ts`, importing everything else.
- Did NOT re-export either constant from the `"use server"` file — a
  type-only re-export would have been safe (types are erased before
  Turbopack's "use server" check runs) but a value re-export would
  reintroduce the same violation, and the spec explicitly warned against
  this for the purge case, so I applied the same caution to board-prefs.
  Consumers (`components/trash/purge-dialog.tsx`,
  `components/board/board.tsx`, `tests/integration/purge-trash-item.test.ts`,
  `tests/unit/f226-swimlane-collapse-persist.test.ts`) now import the moved
  symbols directly from the new `lib/validation/*` module.
- AUTONOMOUS_DECISION: to run `npx next build` without conflicting with the
  dev server already occupying `.next/` on port 3000, I temporarily added a
  no-op-by-default `distDir` override to `next.config.ts` gated behind a
  `PM_APP_BUILD_DIST_DIR` env var (only takes effect when that var is set),
  ran the build with `PM_APP_BUILD_DIST_DIR=.next-build-check npx next
  build`, deleted the scratch dist dir afterward, then `git checkout --
  next.config.ts` to fully revert the override before committing — it is
  not present in the committed diff. `next build` also auto-appends
  `include` entries to `tsconfig.json` and touches `next-env.d.ts` for
  whichever distDir it targets; both were reverted with `git checkout --`
  after every build run, so neither is in the commit either.
- Full `"use server"` sweep: grepped every `.ts`/`.tsx` under `lib/`,
  `app/`, `components/` for the directive. 21 files have it as an actual
  top-level directive (all in `lib/actions/*.ts` plus one non-directive
  false-positive already excluded — see next line); every one of them now
  exports only `async function`s (and, harmlessly, `export type`s, which
  are erased and don't trigger the rule). Three files matched the grep
  string but only inside a comment, not as a directive
  (`lib/validation/workspaces.ts`, `lib/validation/board-prefs.ts`,
  `components/task/task-detail-sheet.tsx`) — confirmed by checking they
  don't start with `"use server"` as their first statement.
- `"use client"` / server-only sweep (F330 sibling class): grepped every
  `"use client"` file for direct imports of `next/headers` or
  `server-only`; zero hits. Did not additionally grep for *transitive*
  imports by hand because a full production `next build` (which now
  succeeds end-to-end across all 29 routes and their client bundles) is a
  stronger and more complete check than a manual import-graph walk — any
  transitive server-only leak into a client bundle fails the build the
  same way F330's direct case did.

## Out-of-scope work needed
None identified. The build is fully green and the sweep found no further
instances of either bug class.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: used a temporary, env-var-gated `distDir` override in
next.config.ts to run `next build` without colliding with the already-running
dev server on port 3000, then reverted it (along with the tsconfig.json /
next-env.d.ts entries Next auto-appends for that distDir) via `git checkout
--` before committing, per the feature's own instruction to build to a
separate distDir if needed and report what was done.

## Notes for the next worker
- `lib/validation/board-prefs.ts` is a new file and is now the canonical home
  for `SWIMLANE_GROUP_BY_PREF_VALUES`, `SwimlaneGroupByPref`,
  `BoardSwimlanePrefs`, `GetBoardSwimlanePrefsResult`,
  `upsertBoardSwimlanePrefsSchema`, `UpsertBoardSwimlanePrefsInput`, and
  `UpsertBoardSwimlanePrefsResult`. `lib/actions/board-prefs.ts` now only
  exports `getBoardSwimlanePrefs` and `upsertBoardSwimlanePrefs`.
- General rule for future `"use server"` action files in this repo: put
  constants, Zod schemas, and derived types in the matching
  `lib/validation/<name>.ts` file from the start — `lib/actions/<name>.ts`
  should only ever contain `"use server";`, imports, and `export async
  function`s. `npx tsc --noEmit` and `vitest` do NOT catch this class of
  bug (types are structurally fine, and vitest doesn't run Turbopack's
  module-boundary checks) — only `next build` does. Consider asking a
  future feature to add `next build` to CI/pre-commit if that isn't already
  planned, since this whole feature existed because nothing had ever run it.
- No MCP tools were relevant to this feature (pure build/module-boundary
  fix, no external service state touched).
