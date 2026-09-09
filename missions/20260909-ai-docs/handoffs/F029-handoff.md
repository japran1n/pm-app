# Handoff: F029 — Positive controls

## Status
COMPLETE

## Assertions covered
AS-020: PASS — new positive control in get-current-doc-isolation.test.ts asserts `status === "ok"` with the real docId/title/markdown for a doc genuinely in the caller's own current workspace.
AS-022: PASS — new positive control in search-docs-isolation.test.ts asserts `status === "ok"` with the matching docId/title/snippet for a real doc in the caller's own current workspace.
AS-024: PASS — new positive control in list-doc-templates-isolation.test.ts asserts `status === "ok"` with the matching template id/name/sections/rules for a real `kind='doc'` template in the caller's own current workspace.
AS-008: PASS — get-current-doc-isolation.test.ts now diffs the cross-workspace result against a genuinely-nonexistent-uuid result (both real `run()` calls), replacing the hardcoded-literal comparison, so byte-identity is proven by construction.
AS-028: PASS — each of the three tools now has a real-DB test covering happy path (this feature), empty/not-found path (pre-existing), and cross-workspace isolation (pre-existing).

## Files changed
lib/ai/__tests__/docs-agent.test.ts
tests/integration/get-current-doc-isolation.test.ts
tests/integration/search-docs-isolation.test.ts
tests/integration/list-doc-templates-isolation.test.ts

## Commands run
`npx tsc --noEmit` (0 exit; output shows only the 4 documented pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — no new errors)
`npx eslint .` (0 exit; 26 warnings, matches documented pre-existing count exactly, no new warnings)
`npx vitest run lib/` (0 exit; 76/76 passed, up from 75/75 — the 1 new test is the forRunner pass-through assertion)
`npx vitest run tests/integration/get-current-doc-isolation.test.ts tests/integration/search-docs-isolation.test.ts tests/integration/list-doc-templates-isolation.test.ts` (0 exit; 3 files / 10 tests SKIPPED — confirms the gate holds with no env var set)
`AI_DOCS_LIVE_DB_TESTS=1 npx vitest run tests/integration/get-current-doc-isolation.test.ts tests/integration/search-docs-isolation.test.ts tests/integration/list-doc-templates-isolation.test.ts` (0 exit; 3 files / 10 tests PASSED against the real linked Supabase project — run twice, once before and once after the mutant-revert cycle, both green)
`git diff --stat` after each mutant revert (empty — confirms clean revert to original source before commit)

## Decisions made
- Did not use Supabase MCP for this feature: F029 only adds test code against tools/routes already covered by F024/F027's live-DB harness (support/live-db.ts), and does not touch schema, RLS policies, or migrations. No new live-state introspection was needed beyond what the existing isolation suites already do via the admin client at test time.
- Positive controls are separate `describe` blocks per file, each with their own beforeAll/afterAll seeding a single-workspace, single-user, single-doc/template fixture — kept isolated from the existing two-workspace describes (F024, F027) rather than bolted onto them, so a failure in the new block can't be confused with an existing cross-workspace assertion, and cleanup uses the same admin-client pattern plus the F031 `sweepLeakedFixtures` belt-and-suspenders call.
- Used the `f024-` fixture-name prefix (not a new `f029-` prefix) for the new positive-control fixtures, since `LEAK_PREFIXES` in each file is already `["f024-", "f027-"]` and these are conceptually part of the same F024 "does the tool actually work end to end" surface — avoids having to also update the sweep prefix list (which is shared infrastructure I was told not to bypass, not to extend).
- For the `forRunner` pass-through test, mocked all three tool modules' `run` (not just get-current-doc, which was already mocked) so each of the three `betaZodTool`-wrapped runners could be invoked independently through `request.tools[i].run(...)` and the underlying `tool.run` call inspected for its second argument — this is the SDK-level entry point a real tool-runner would call, so a `forRunner` that drops `workspaceId` before delegating is caught regardless of how the drop happens (wrong arg count, wrong arg order, or accidentally re-deriving a stale value).
- AS-008 byte-identity fix diffs two *actual* `run()` results against each other (cross-workspace doc vs. a hardcoded genuinely-nonexistent uuid) rather than against a literal — this is strictly additive to the existing `toEqual({...})` assertion in the same file (left untouched, since it still passes and provides its own coverage of the exact literal shape); the new test is the one that proves the identity can't drift.

## Out-of-scope work needed
None identified. F029's three build items (positive controls, forRunner assertion, AS-008 byte-identity fix) are all implemented and verified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reused the existing `f024-`/`f027-` LEAK_PREFIXES sweep list for the new positive-control fixtures instead of introducing an `f029-` prefix, since the spec's "use the same gate and sweep" instruction reads most naturally as "don't add a new untracked prefix that the sweep wouldn't catch" rather than "invent a new namespace." If a future worker wants F029-specific fixtures distinguishable in the live project by prefix, they can add `f029-` to `LEAK_PREFIXES` in `tests/integration/support/live-db.ts` (a one-line, additive change) and update the three isolation files' local `LEAK_PREFIXES` const accordingly.

## Notes for the next worker
- All four proof-of-failure mutants were applied one at a time, confirmed red, and reverted before committing:
  1. `forRunner`'s `run: async (args) => JSON.stringify(await tool.run(args, workspaceId))` → dropped `workspaceId` → new `test_F029_forRunner_passes_the_request_workspaceId_as_the_second_argument_to_every_tool_run` test in `lib/ai/__tests__/docs-agent.test.ts` went red (`toHaveBeenCalledWith` mismatch, second arg missing).
  2. `get-current-doc.ts`'s `if (!data || data.workspace_id !== workspaceId)` → `if (!data || true)` → new AS-020 positive-control test went red (`expected 'empty' to be 'ok'`). The pre-existing cross-workspace tests in the same file did NOT catch this on their own (they already expected "empty" either way), confirming the original blocker's premise.
  3. `search-docs.ts`'s `builder.eq("workspace_id", workspaceId)` → hardcoded to the nil uuid → new AS-022 positive-control test went red the same way.
  4. `list-doc-templates.ts`'s `.eq("workspace_id", workspaceId)` → hardcoded to the nil uuid → new AS-024 positive-control test went red the same way.
  All four were reverted with `cp` from `/private/tmp/claude-.../scratchpad`-adjacent backups taken before mutation, and `git diff --stat` on the four source files was empty afterward, confirming no mutant leaked into the commit.
- The TypeScript compiler collapses `request.tools[i]` (a 3-element readonly tuple of differently-shaped `betaZodTool` results) into an unsatisfiable intersection type when accessed generically through `.map()`/`Map.get()`. Worked around this in the new forRunner test with a local `AnyRunnable` type and a cast on `request.tools`, since the test's whole point is to call each tool's `run` with ITS OWN argument shape at the JS level — the SDK's own `BetaRunnableTool` type isn't structured for that kind of heterogeneous-array indexing in a test harness.
- Did not touch `tests/integration/support/live-db.ts` itself, per the mission's explicit instruction to use the F031 gate/sweep as-is.
- Did not run the full `npm test` — per the mission's standing rule (documented in `state.md`) about burning the user's live Supabase Auth rate limit across ~200 integration files. Only ran the targeted live-DB suites plus `lib/` unit tests as instructed.
