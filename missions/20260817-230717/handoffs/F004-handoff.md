# Handoff: F004 — ci pipeline

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature, per feature spec)

## Files changed
.github/workflows/ci.yml
package.json

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0)
`npx js-yaml .github/workflows/ci.yml` (0) — YAML syntax validation

## Decisions made
- Workflow triggers on `push` and `pull_request` (all branches), per spec.
- Node version pinned to `20.9` in `actions/setup-node`, matching Next.js 16's documented floor (Node 20.9+) from tech-decisions.md.
- Used `npm ci` for dependency install since `package-lock.json` exists and is committed.
- Typecheck/lint/test steps use the EXACT commands from tech-decisions.md: `npx tsc --noEmit`, `npx eslint .`, and `npm run test` (tech-decisions.md's test command is `npm run test && npx playwright test`; I split this into two CI steps — "Unit tests" running `npm run test` and a separate "End-to-end tests (Playwright)" step — for clearer CI failure isolation, while keeping the same underlying commands).
- Added a `"test"` script to `package.json` (previously missing). No vitest config/tests exist yet (unit tests arrive in F091), so the script guards: if `tests/unit` exists and is non-empty, run `vitest run`; otherwise print a note and exit 0. This keeps `npm run test` — the exact command the local pre-worker-exit hook also uses — from hard-failing on a nonexistent script or missing vitest binary.
- The Playwright E2E step is similarly guarded: it only runs `npx playwright install --with-deps && npx playwright test` if `@playwright/test` is an installed dependency AND `tests/e2e` has files; otherwise it echoes a skip message and exits 0. `@playwright/test` is not yet installed (arrives in F090).
- Did not add any deployment steps — explicitly out of scope per the task.

## Out-of-scope work needed
- F090 (Playwright e2e suite): once landed, remove the `npm ls @playwright/test` / `tests/e2e` guard in `.github/workflows/ci.yml`'s "End-to-end tests (Playwright)" step so it runs unconditionally (or fails loudly if the suite is missing).
- F091 (vitest unit suite): once landed, remove the `tests/unit` existence guard in package.json's `"test"` script and add `vitest.config.ts` / replace with a direct `vitest run` (or `vitest run --passWithNoTests` if an empty-suite tolerance is still wanted long-term).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: package.json had no `"test"` script at all (only dev/build/start/lint existed from F001). tech-decisions.md's "How to run tests" section assumes `npm run test` exists. Rather than block on this, I added a temporary guarded placeholder script (see Decisions made) so both this CI workflow and the local pre-worker-exit hook (which also runs the tech-decisions.md test command) succeed on the current empty-test-suite state, with explicit skip messaging rather than a silent no-op. This is documented here as a known temporary state per the task instructions, not hidden.
AUTONOMOUS_DECISION: Pinned Node to the minor version "20.9" (rather than the broader "20") to match tech-decisions.md's explicit floor "Node 20.9+" literally; GitHub's setup-node resolves this to the latest available 20.9.x patch.

## Notes for the next worker
- CI workflow file: `.github/workflows/ci.yml`.
- Both the "Unit tests" and "End-to-end tests (Playwright)" CI steps are intentionally tolerant no-ops right now — see the NOTE comments inline in ci.yml and the "Out-of-scope work needed" section above for exactly what to remove once F090/F091 land.
- No MCP tools were used for this feature (none applicable — pure local config/workflow file, no external service state to introspect).
