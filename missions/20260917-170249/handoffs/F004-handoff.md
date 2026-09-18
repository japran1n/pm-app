# Handoff: F004 — converter route smoke test

## Status
COMPLETE

## Assertions covered
AS-008: PASS — `tests/unit/f004-webflow-tool-portal-isolation.test.ts` confirms (1) no `tools/webflow` route exists anywhere under `app/(portal)/**`, and (2) no non-test source file inside `app/(portal)/**` textually references the tool's route path (`tools/webflow`) or module paths (`components/webflow-tool`, `lib/webflow-converter`, `lib/actions/webflow-converter`). Both sub-tests pass.

## Files changed
tests/unit/f004-webflow-tool-portal-isolation.test.ts

## Commands run
`npx vitest run tests/unit/f004-webflow-tool-portal-isolation.test.ts` (0, 2/2 tests pass)
`npm run lint` (0, no warnings/errors)
`npm run build` (0, `/w/[workspaceSlug]/tools/webflow` present in route table, no `/portal/*/tools/webflow` entry)
`npx vitest run --exclude "tests/integration/**"` (0, 473 files / 3105 tests passed, 1 skipped) — full non-network unit suite, confirms F002 (route) + F003 (nav) + F004 (this feature) are all green together
`npm test` (full suite incl. integration) — 173 integration-test failures, all `TypeError: fetch failed` against Supabase (confirmed via a network probe in this sandbox: `curl https://example.com` also fails with no network). Pre-existing environment constraint, unrelated to this feature or any file this feature touches — none of the failing test files reference webflow/converter/tools.

## Decisions made
- Followed the existing grep-based portal-isolation/route-sweep pattern from `tests/unit/f009-legacy-portal-route-redirects.test.ts` (walk `app`/`components`/`lib`, exclude `node_modules`/`.next`/`(workspace)`, skip `.test.ts(x)` files) rather than inventing a new pattern, per the spec's "matching how other portal-isolation tests in this repo are written."
- Scoped the textual-reference check to files inside `app/(portal)/**` only (not all of `app`/`components`/`lib`), because the workspace-side sidebar (`components/nav/app-sidebar.tsx`, F003) is *supposed* to link to `/w/[workspaceSlug]/tools/webflow` — that's a different, team-facing surface, not the client-facing portal AS-008 is about. Flagging it as an offender would be a false positive.
- Added a second, independent route-existence check (raw filesystem walk of `app/(portal)` for any path containing `tools/webflow`) in addition to the textual sweep, since the spec allows "grep-based or import-graph based" and this belt-and-suspenders approach catches a stray route file even if nothing links to it yet.

## Out-of-scope work needed
None identified for this feature. The converter's actual editor/preview/results UI (F0xx components under `components/webflow-tool/`) is explicitly out of scope per this feature's "Files (approximate)" line and tech-decisions.md's file layout — those are separate features later in the plan.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Confirmed AS-008's exact wording from `validation-contract.md` line 19 ("The converter page does not appear anywhere inside the client-facing portal (`/portal/*`)") since the feature spec's own "Draft scope" line referenced the assertion only by ID. Used that wording to decide the test should check both route-existence and cross-linking, not just one.
AUTONOMOUS_DECISION: Treated the `npm test` integration-suite failures as an environment limitation (no network access in this sandbox to reach Supabase) rather than a real regression, based on (a) every failure being `fetch failed` against Supabase, (b) a direct network probe confirming no internet access in this environment, and (c) none of the 252 failing test files touching webflow/converter/tools code. Verified the feature's own scope is green via the full non-integration unit suite (473 files / 3105 tests, 0 failures) instead of relying on the network-dependent integration run.

## Notes for the next worker
- Milestone 1 (F002 route skeleton + F003 nav item + F004 this smoke test) is confirmed green together: `npm run lint`, `npm run build`, and the full non-integration unit suite all pass with all three features' code present.
- If a future milestone validator needs the *full* `npm test` (including integration) to be green, that will require either running in an environment with outbound network access to the Supabase project referenced in `.env`, or accepting `describe.skipIf(!haveCreds)`-style skips — this is a pre-existing repo/environment condition, not something introduced by F002/F003/F004.
- No MCP usage for this feature (registry has no rows relevant to a pure filesystem/grep smoke test).
