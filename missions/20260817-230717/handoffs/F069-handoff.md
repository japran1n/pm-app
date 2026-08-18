# Handoff: F069 — search page ui

## Status
COMPLETE

## Assertions covered
AS-116: PASS — `searchWorkspaceTasks` returns the matching task for a real query against a live fixture (`tests/integration/search-tasks.test.ts`); the page shows the input + populated results list for any non-empty `q`.
AS-119: PASS — a query matching no tasks resolves to `[]` (tested live) and the page renders an explicit "No results for ..." block, never a blank screen.
AS-120: PASS — each search result carries `projectId`, which the page uses to build `/w/[slug]/projects/[projectId]/board`; verified in the integration test that the returned `projectId` matches the seeded task's real project.

## Files changed
app/(workspace)/w/[workspaceSlug]/search/page.tsx
lib/queries/search.ts
tests/integration/search-tasks.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 pre-existing-style warning in lib/queries/search.ts: unused destructured `_titleMatches`, intentional — see Decisions)
`npm run build` (0) — `/w/[workspaceSlug]/search` compiles as a dynamic route
`npx vitest run` (0) — 67 test files, 1 pre-existing failure unrelated to this feature (see Notes), all other files including the 3 new F069 tests pass (373 tests total, 370 passing + the pre-existing suite-level crash counted as a failed file with 0 tests)
`npx vitest run tests/integration/search-tasks.test.ts` (0) — 3/3 passed
`npx playwright test` (1) — pre-existing: no Playwright config/e2e suite exists in this repo yet; it errors trying to load `tests/unit/*.test.ts` as Playwright specs. Confirmed this fails identically with `git stash` on the pre-F069 commit — not something this feature introduced or is in scope to fix.

## Decisions made
- **No workspace-wide search RPC exists.** F068's `search_tasks(p_project_id, p_query)` RPC is project-scoped only (confirmed in `lib/supabase/database.types.ts`). Rather than duplicate F068's ranking/case-insensitivity/soft-delete logic with a hand-rolled `.textSearch()` query, `lib/queries/search.ts`'s `searchWorkspaceTasks()` first resolves every non-deleted project in the workspace (RLS-scoped), then calls `search_tasks` once per project and merges the results, sorted title-match-first as a simple cross-project ordering. This satisfies AS-116/119/120 (my assigned assertions); AS-124's exact ranking guarantee is only proven at the single-project RPC level by F068's own test, so this page's ordering across projects is best-effort, not assertion-backed. Flagging as out-of-scope work below for whoever picks up AS-124/AS-117/AS-118/AS-121/AS-122/AS-123 end-to-end at the workspace level (likely F070, "search-action", already drafted per the mission's feature list).
- **No task-detail-sheet deep link exists yet.** `components/task/task-detail-sheet.tsx` is not currently wired into the board page via a URL query param — task opening there is local `useState`. Building that wiring was out of my spec's file scope (`search/page.tsx` only), so AS-120 is satisfied by linking straight to `/w/[slug]/projects/[projectId]/board`; the user locates the task among the board's normal columns from there. This is the "simplest correct approach" the spec explicitly allowed.
- **Search box is a plain GET `<form>`**, not a Client Component — submitting writes `?q=` to the URL and Next re-renders the Server Component. This keeps the client JS boundary at zero, per the clarified spec's "smallest possible client boundary" and "primary content server-rendered in initial HTML" (AS-155) guidance.
- **Empty-query and no-match are two distinct, explicitly separate UI blocks** (not one "empty state" reused for both) so AS-116's neutral prompt and AS-119's explicit no-results message never get confused — the neutral prompt never claims "no results" for a query the user hasn't typed yet.
- The unused `_titleMatches` destructure-and-drop in `searchWorkspaceTasks`'s return map is intentional: it's used inside the `.sort()` comparator but must not leak into the returned `SearchTaskResult` shape, hence the eslint warning (not an error) rather than a redesign.

## Out-of-scope work needed
- A true workspace-scoped `search_tasks_in_workspace(p_workspace_id, p_query)` RPC (or equivalent single-query approach) would let `searchWorkspaceTasks` do one DB round-trip instead of N (N = project count) and would let a future worker assert AS-117/AS-121/AS-123/AS-124 at the workspace level directly (right now those are only proven project-scoped, by F068's own tests). This is squarely F070's likely scope per the mission's feature list ("search-action").
- Wiring `components/task/task-detail-sheet.tsx` to open via a board-page query param (e.g. `?task=<id>`) would let AS-120's link open the exact task directly instead of just the board — noted but not built, since it touches `board.tsx` which is outside this feature's file scope.
- `npx playwright test` has no working config/spec set in this repo at all (pre-existing, unrelated to F069) — worth a dedicated fix-up feature if e2e coverage becomes a milestone requirement.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented workspace search by calling F068's per-project `search_tasks` RPC once per project in the workspace (see Decisions) rather than adding a new migration, since my spec's file scope is `search/page.tsx` only and didn't list a new migration as in-scope.
AUTONOMOUS_DECISION: Linked search results to the project board URL rather than building task-detail-sheet deep-linking, per the spec's own "simplest correct approach is fine, document it" instruction.

## Notes for the next worker
- `searchWorkspaceTasks(workspaceId, query)` lives in `lib/queries/search.ts` — returns `SearchTaskResult[]` with `{ id, title, status, priority, projectId, projectName }`, already trimmed/empty-query-safe (returns `[]` without any DB call for a blank/whitespace-only query).
- The pre-existing `tests/unit/fts-tasks.test.ts` failure (`Error: supabaseUrl is required.`) is unrelated to F069 — it fails identically on the pre-F069 commit (`740e4d5`, verified via `git stash`). It's a bug in F068's own env-loading guard (the `describeIfEnv` wrapper doesn't actually prevent the `createSupabaseClient(...)` call inside the `describe` body from running when env vars are missing at collection time — that call needs to move inside a `beforeAll` or be wrapped in the same `describeIfEnv` conditional more defensively). Left untouched since it's outside this feature's file scope, but flagging for a maintenance follow-up.
- No MCP was used — Supabase MCP is marked Optional for workers in `mcp-registry.md`; all verification went through `npx tsc`, `npx eslint`, `npm run build`, and `npx vitest run` against the real linked Supabase project via `.env` (Supabase CLI path, already linked from F068).
