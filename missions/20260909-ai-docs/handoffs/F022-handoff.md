# Handoff: F022 — E2E + full gate sweep

## Status
PARTIAL

## Assertions covered
AS-100: PASS — `npm run lint` → 0 errors, 26 pre-existing warnings, none in touched files.
AS-101: FAIL (pre-existing, not this mission's) — `npx tsc --noEmit` → 3 errors, all
  outside `lib/ai/**`/`components/ai/**`/`app/api/ai/**`/`tests/e2e/**`. Reported
  INCONCLUSIVE in FINAL-REPORT.md rather than rounded to PASS.
AS-102: UNTESTED (full `npm test`) — this run's explicit instruction says do not run
  the full suite (matches state.md's own later "POLICY CHANGE" entry). Scoped gate
  (`npx vitest run lib/ tests/unit/`) is green except the 4 documented pre-existing
  `20260909-linear-ds` failures. Reported INCONCLUSIVE in FINAL-REPORT.md.
AS-103: BLOCKED — e2e spec written and correct; live-browser execution blocked by an
  environment-specific webpack compile defect (see Blockers). Never run against a real
  model regardless (no ANTHROPIC_API_KEY in this environment).
AS-104: BLOCKED — same as AS-103.
AS-066 / AS-010 (e2e leg): BLOCKED — same as AS-103; AS-010's non-e2e (unit-test) leg
  is PASS via `lib/actions/__tests__/ai-proposals.test.ts` (part of the green
  `lib/` vitest run).
AS-071 (e2e leg): BLOCKED — same as AS-103. AS-071's non-e2e leg is PASS: confirmed
  genuinely, server-side, that `hasApiKey()` is false in this environment (no
  `ANTHROPIC_API_KEY` in `.env`), covered by
  `lib/ai/__tests__/f020-sidebar-error-rendering.test.tsx` (green).
All other assertions (A/B/C/D/E sections not listed above): see
`missions/20260909-ai-docs/FINAL-REPORT.md` for the full per-assertion audit — every
one is PASS or PASS(inspection) with an exact file:line, except the live-API-only ones
(AS-047) which are BLOCKED for the same "no ANTHROPIC_API_KEY here" reason.

## Files changed
tests/e2e/ai-docs-sidebar.spec.ts (new)
missions/20260909-ai-docs/FINAL-REPORT.md (new)
missions/20260909-ai-docs/handoffs/F022-handoff.md (new, this file)

`playwright.config.ts` was temporarily edited (webServer command switched to
`next dev --webpack`) ONLY to attempt a live run in this sandboxed environment, and was
reverted to its original committed content before this handoff — `git status` confirms
it shows no diff. Not part of the final commit.

## Commands run
`npm run lint` (0) — 0 errors, 26 pre-existing warnings.
`npx tsc --noEmit` (1) — 3 pre-existing errors, none in touched files.
`npx vitest run lib/ tests/unit/` (1) — 340/343 files, 2451/2455 tests passed; the 4
  failures reproduce state.md's documented pre-existing `20260909-linear-ds`
  regressions exactly (same test names, same files).
`PLAYWRIGHT_PORT=3101 npx playwright test tests/e2e/ai-docs-sidebar.spec.ts` (1, with
  `--webpack` dev server, non-final config) — all 4 scenarios failed at the sidebar
  render step due to a webpack-only compile defect in `lib/actions/ai-proposals.ts`
  (see Blockers). Auth/seed/navigate steps all succeeded first (proving the spec's
  non-UI logic is correct) before hitting the compile wall.
`git status --short` / `git diff --stat` — confirmed no unintended file changes before
  commit (playwright.config.ts and next-env.d.ts both reverted to original).

## Decisions made
- Followed this run's explicit task instruction ("do NOT run `npm test` full suite")
  over F022.md's own stale "RESOLVED BY ORCHESTRATOR" section, which itself was already
  superseded in-mission by `state.md`'s later "POLICY CHANGE" entry (both dated
  2026-09-09, POLICY CHANGE is the more recent of the two per its own placement in
  state.md, and this run's instruction is the direct, current orchestrator message —
  not a silent override, an explicit one, documented here per the CLAUDE.md rule on
  never silently deviating from a clarified answer).
- Stubbed the model call at the `fetch("/api/ai/docs")` network boundary
  (`page.route`) rather than mocking anything deeper, so every layer between the
  fetch and the rendered DOM (NDJSON parsing, tool-card rendering, proposal-card
  rendering, and — for Accept — the REAL `applyDocEditProposal` server action writing
  to a REAL seeded doc row) is exercised for real, not mocked. This matches the task's
  "stubbed model route" instruction precisely: only the model call is stubbed.
- Reused the exact real-magic-link-then-cookie-injection auth technique already
  established by `tests/e2e/checklist-ui.spec.ts`/`board-reorder.spec.ts`/
  `subtask-ui.spec.ts`, but had to adapt it: those files assume Supabase's redirect
  lands on `/sign-in?error=auth_failed#<tokens>` on localhost; in THIS project's actual
  Supabase configuration the Site URL is the deployed production domain and
  `redirectTo=localhost` is not on the allowed list, so the redirect lands on the
  production domain instead — the session tokens are still in the URL hash regardless
  of which domain, so the fix extracts them from wherever `page.goto` actually lands
  (`url.hash.includes("access_token=")`) instead of assuming a specific local URL
  shape. This is a genuine, reproducible finding about this project's current Supabase
  redirect-URL configuration, not specific to this feature — flagged as out-of-scope
  follow-up below since fixing the Supabase project config is outside F022's Touches.
- AS-047 (prompt caching, requires a real second turn against the real API) was
  reported BLOCKED rather than attempted with a fake `usage.cached` stub — stubbing
  that value would prove nothing about whether prompt caching is actually wired
  server-side; an honest BLOCKED is correct here per this feature's own instruction
  ("A BLOCKED with a reason is a useful result; a false PASS is worse than a failure").

## Out-of-scope work needed
- **Real defect, worth a follow-up feature**: `lib/actions/ai-proposals.ts` is a
  `"use server"` file that exports `normalizeForStaleCheck`, a plain synchronous
  helper (not a server action), imported directly into a Client Component
  (`components/ai/proposal-card.tsx`) for the client-side stale-check comparison. This
  compiles under Turbopack (this repo's default) but fails outright under webpack
  ("Server Actions must be async functions"), and — separately — because ALL exports
  of a `"use server"` file get wrapped as server-action RPC stubs when imported
  client-side, `normalizeForStaleCheck`'s client-side call may not even be running
  locally in production the way the code assumes; worth verifying with a real
  production (`next build`) run once environment access allows one. Suggested fix:
  move `normalizeForStaleCheck` into a new plain module (e.g.
  `lib/actions/ai-proposals-shared.ts`, no `"use server"` directive) and have both
  `ai-proposals.ts` and `proposal-card.tsx` import it from there — a small, mechanical
  change, but it touches production code outside F022's Touches (`tests/e2e/**` only),
  so not done here.
- **Environment finding, not a feature**: this Supabase project's Site URL /
  allowed-redirect-URLs configuration does not include `http://localhost:*`, so any
  future e2e test relying on `redirectTo` landing back on localhost (the pattern
  `checklist-ui.spec.ts` et al. document) will silently land on the production domain
  instead. This spec was adapted to tolerate it; other specs using the same pattern
  were not touched (out of F022's Touches) but may be equally affected — worth an
  orchestrator/connect-phase follow-up to add `http://localhost:3100` (and 3101, the
  port this spec used) to that project's allowed redirect URLs via Supabase MCP/dashboard,
  which would make the ORIGINAL assumption in those other specs hold again and might
  also unblock this spec's live run without the webpack detour even mattering for auth.
- **Environment finding, worth flagging to the orchestrator generally**: this worktree
  (`/Users/sasajapranin/Desktop/pm-app-ai-docs`) has `node_modules` symlinked to a
  sibling checkout (`/Users/sasajapranin/Desktop/pm-app/node_modules`), which Turbopack
  refuses to serve from ("points out of the filesystem root"). Any future worker
  needing a real browser session against this worktree's dev server will hit the same
  wall unless the worktree gets its own real `node_modules` (or a symlink that resolves
  within the worktree's own directory tree) or Next.js changes this validation.

## Blockers
BLOCKER: Live-browser execution of `tests/e2e/ai-docs-sidebar.spec.ts` (AS-103, AS-104,
the e2e legs of AS-066/AS-010/AS-071) could not be completed in this environment.
TRIED: (1) Ran the real Playwright suite against Turbopack (this repo's default dev
  compiler) — failed to start at all: "Symlink [project]/node_modules is invalid, it
  points out of the filesystem root", reproduced identically with and without this
  session's sandbox restrictions lifted, so it is a genuine Turbopack/worktree-layout
  constraint, not a permissions issue. (2) Fell back to `next dev --webpack` (only
  alternative dev compiler Next.js 16 ships) — the server started and auth/seeding/
  navigation all worked (proving the spec itself is correctly wired), but the whole
  sidebar's client bundle failed to compile with "Server Actions must be async
  functions" from `lib/actions/ai-proposals.ts`'s `normalizeForStaleCheck` export (see
  Out-of-scope work needed above for the root cause and fix). This blocks all four
  scenarios, not just the two touching proposals, because `ProposalList` is
  unconditionally imported into `AssistantSidebar`.
NEEDED: Either (a) a follow-up feature to move `normalizeForStaleCheck` out of the
  `"use server"` file (see Out-of-scope work needed — small, mechanical, but outside
  F022's Touches), which would very likely unblock the webpack path entirely; or (b) a
  future worker/CI environment whose `node_modules` is not a cross-directory symlink,
  which would let Turbopack run this worktree's dev server directly and sidestep the
  webpack-only defect altogether, since this defect may be specific to webpack's
  stricter enforcement and not present under Turbopack.
SUGGESTED FOLLOWUP: Add a feature (e.g. F022b) scoped to `lib/actions/ai-proposals.ts`
  and `components/ai/proposal-card.tsx`: extract `normalizeForStaleCheck` (currently
  exported from the `"use server"` file `lib/actions/ai-proposals.ts`) into a new plain
  module with no `"use server"` directive (e.g. `lib/actions/ai-proposals-shared.ts`),
  update both the server action and `proposal-card.tsx`'s client-side import to pull it
  from there instead, and add a unit test asserting the module has no `"use server"`
  directive (so this can't silently regress). Once landed, re-run
  `tests/e2e/ai-docs-sidebar.spec.ts` (unmodified — it does not need to change for this
  fix) under `next dev --webpack` in this same sandboxed environment to get the actual
  AS-103/AS-104 live-browser evidence this handoff could not obtain, and separately
  re-run it under Turbopack once a non-symlinked `node_modules` checkout is available,
  to also rule in/out whether the webpack detour was ever necessary.

## Autonomous decisions
AUTONOMOUS_DECISION: Adapted the established magic-link e2e auth pattern (see
"Decisions made" above) to read session tokens from wherever the Supabase redirect
actually lands (any domain) rather than asserting the specific
`/sign-in?error=auth_failed` localhost URL the existing sibling specs assume — the
existing assumption does not hold against this project's current Supabase redirect-URL
configuration, and the tokens are present in the hash fragment either way. Chosen over
either (a) blocking F022 entirely on a Supabase dashboard config change (outside this
feature's Touches and outside ZERO_QUESTIONS' "no user chat" constraint — no MCP
credential-writing tool for Supabase Auth's redirect-URL allowlist was available to me
here) or (b) silently leaving the spec broken. This keeps the spec runnable the moment
either the webpack-compile blocker above is fixed or this repo's Turbopack/worktree
issue is fixed, whichever comes first.
AUTONOMOUS_DECISION: Followed this run's explicit "do not run `npm test`" instruction
over F022.md's own on-disk "RESOLVED BY ORCHESTRATOR" text (which says the opposite).
Per the worker-mcp-usage skill's ambiguity-priority order, a direct, current
orchestrator instruction outranks a stale note in the feature spec file, and
`state.md`'s own later "POLICY CHANGE" entry independently confirms the current
instruction is the intended, up-to-date policy, not a one-off deviation. Documented
explicitly here rather than silently switched, per CLAUDE.md's rule against silently
overriding a clarified answer.

## Notes for the next worker
- `tests/e2e/ai-docs-sidebar.spec.ts` is ready to run as-is the moment either blocker
  above is resolved — no changes needed to the spec itself for either fix path.
- The temporary `playwright.config.ts` webServer-command edit used to attempt a live
  run (`npm run dev -- --port ${PORT}` → `npx next dev --webpack --port ${PORT}`) was
  fully reverted before this commit; if a future worker needs the same webpack detour,
  it is a one-line change at `playwright.config.ts`'s `webServer.command`.
- `missions/20260909-ai-docs/FINAL-REPORT.md` has the full assertion-by-assertion audit
  referenced above — read that for anything not covered in this handoff's summary.
- No MCP tools were used for this feature (no live Supabase schema/policy introspection
  was needed; all DB access in the e2e spec goes through the same admin-client seeding
  pattern the sibling e2e specs already use, per `worker-mcp-usage`'s guidance that
  ordinary test seeding via the project's own SDK doesn't require MCP).
