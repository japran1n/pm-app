# Handoff: F118 — install v2 dependencies

## Status
COMPLETE

## Assertions covered
none (foundation feature — no assertion IDs assigned)

## Files changed
package.json
package-lock.json
.env.example

## Commands run
`npm view @tiptap/react version` (0) — 3.30.2
`npm view @tiptap/pm version` (0) — 3.30.2
`npm view @tiptap/starter-kit version` (0) — 3.30.2
`npm view @tiptap/extension-mention version` (0) — 3.30.2
`npm view @tiptap/extension-link version` (0) — 3.30.2
`npm view @tiptap/extension-task-list version` (0) — 3.30.2
`npm view @tiptap/extension-task-item version` (0) — 3.30.2
`npm ls resend` (0) — resend@6.20.0 already installed
`npm ls @react-email/components` (0) — @react-email/components@1.0.12 already installed
`npm view resend version` (0) — 6.20.0 (matches installed, no reinstall needed)
`npm view @react-email/components version` (0) — 1.0.12 (matches installed, no reinstall needed)
`npm install @tiptap/react@^3.30 @tiptap/pm@^3.30 @tiptap/starter-kit@^3.30 @tiptap/extension-mention@^3.30 @tiptap/extension-link@^3.30 @tiptap/extension-task-list@^3.30 @tiptap/extension-task-item@^3.30` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 1 pre-existing unrelated warning in lib/queries/search.ts (`_titleMatches` unused var), 0 errors
`npm run build` (0)
`npm run test` (0) — 96 test files, 504 tests passed
`npx playwright test` (1) — failed to start webServer: "Another next dev server is already running" (PID 61223, uptime ~6h, pre-existing process on port 3000, unrelated to this change — see Notes)

## Decisions made
- Verified npm registry versions at install time rather than trusting tech-decisions.md's embedded verification comments (which were dated 2026-08-18 but per this feature's explicit instruction must be re-checked, not copied from memory). All seven Tiptap packages resolved to 3.30.2 on npm at install time; installed with `^3.30` range as tech-decisions.md specifies, landing on 3.30.2.
- Did not reinstall `resend` or `@react-email/components` — both were already present at the exact versions tech-decisions.md targets (6.20.0 and 1.0.12 respectively, both also the current npm-published latest). Verified via `npm ls` and `npm view`.
- `cmdk` was intentionally NOT installed here — per the feature spec, it arrives via `npx shadcn@latest add command` in F119.
- Followed the orchestrator's explicit run instructions over the feature spec's draft text: the spec's "Draft scope" says `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are "already written to .env by the connect phase," but the task instructions and `connections/mcp-registry.md` both state Resend is NOT connected, no API key exists, and F213–F217 are skipped. Confirmed by inspecting `.env` key names only (no values read/printed): no `RESEND_*` keys are present. Did not write any Resend values into `.env`. Added `RESEND_API_KEY=` and `RESEND_FROM_EMAIL=` as empty key names only to `.env.example`, with a comment noting the service isn't connected yet.

## Out-of-scope work needed
- `cmdk` / command palette installation — explicitly deferred to F119 per spec, not this feature's scope.
- The pre-existing Next.js dev server on PID 61223 (port 3000, listening) blocks `npx playwright test` from starting its own dev server on port 3100 (Next's dev-server lock is global, not per-port). This is an environment condition unrelated to the F118 dependency install — no code under test changed in a way that would affect `tests/e2e/board-reorder.spec.ts`. Recommend the orchestrator either stop stray dev servers before running Playwright at a milestone boundary, or confirm CI runs don't have this leftover-process issue.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated the feature spec's claim that Resend env vars were "already written to .env" as stale/incorrect against the more specific and more recent orchestrator instructions and mcp-registry.md (Resend not connected, F213-F217 skipped). Did not write any RESEND_* values into `.env`; only added the two empty key names to `.env.example` as instructed.
AUTONOMOUS_DECISION: Installed Tiptap packages with `^3.30` semver ranges (matching tech-decisions.md's stated intent) after confirming 3.30.2 is the current npm-published version for all seven packages, rather than pinning exact versions — consistent with the loose-range convention already used throughout package.json.

## Notes for the next worker
- All Tiptap 3.x packages (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`) are now in `package.json` at `^3.30.2`, resolved and installed (`node_modules` + `package-lock.json` updated, 50 packages added).
- `resend` (^6.20.0) and `@react-email/components` (^1.0.12) were already present and did not need reinstalling — confirmed against current npm-published versions.
- `.env.example` now lists `RESEND_API_KEY=` and `RESEND_FROM_EMAIL=` as empty key names (no values), with a comment that the service isn't connected and F213-F217 are skipped. `.env` itself was NOT touched — it has no Resend keys, consistent with mcp-registry.md.
- `npm run build`, `npx tsc --noEmit`, and `npx eslint .` are all clean (eslint has one pre-existing, unrelated warning; 0 errors).
- `npm run test` (Vitest unit + integration) is fully green: 96 files / 504 tests.
- `npx playwright test` could not run to completion in this environment because a stray `next dev` process was already bound on port 3000 from outside this session (PID 61223, ~6h uptime), which trips Next's single-dev-server lock when Playwright's webServer tries to boot its own instance on port 3100. This is not caused by, or related to, the dependency changes in this feature — no e2e-covered code path (board drag-and-drop) was touched.
- No MCP tools were used for this feature (mcp-registry.md marks Resend "Worker use: No"; Supabase/Playwright MCP were not applicable to a pure npm dependency install).
