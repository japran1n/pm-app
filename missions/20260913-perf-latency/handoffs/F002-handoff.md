# Handoff: F002 — Request-scoped workspace-by-slug helper

## Status
COMPLETE

## Assertions covered
AS-002: PASS — `lib/queries/workspaces.ts` exports a single `cache()`-wrapped `getWorkspaceBySlug(slug)` that queries `workspaces` by slug via the shared F001 `getRequestClient()`, selecting the union of every column an existing call site reads (`id, name, slug, logo_url`). Verified with 4 structural tests in `tests/unit/pf-workspace-slug-cache.test.ts` (4/4 passing) and by full gate run (`GATE PASSED`).

## Files changed
lib/queries/workspaces.ts (added `getWorkspaceBySlug`, new imports `cache` from `react` and `getRequestClient` from `@/lib/auth/current-user`)
tests/unit/pf-workspace-slug-cache.test.ts (new)

## Commands run
`npx vitest run tests/unit/pf-workspace-slug-cache.test.ts` (0, 4/4 passed)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches accepted baseline)

## Decisions made
- Surveyed every `.eq("slug", workspaceSlug)` call site in `app/(workspace)/w/[workspaceSlug]/**` (grep, ~40 files). The audit's "thirteen times" refers to the nested layouts + leaf pages under one route tree (workspace layout, project layout, docs layout, chat layout, plus every page under them each re-querying). Column sets in use today: `id` only (docs layout, chat layout, projects/[projectId]/docs layout), `id, name` (project layout, `w/[workspaceSlug]/page.tsx`, `projects/page.tsx`), and `id, name, slug, logo_url` (the top-level workspace layout, which needs `slug`/`logo_url` for the switcher). Chose `id, name, slug, logo_url` — the union — as the helper's select, per the spec's explicit instruction ("If they select different column sets, return a shape that satisfies all of them"). A caller reading only `id` is unaffected by the extra fields being present on the returned row.
- Decided the `workspace_slug_history` fallback (permanentRedirect to a renamed workspace's current slug) stays OUT of the shared helper and remains call-site logic in the top-level workspace layout only. Reasoning, also written into the file's doc comment: every other call site that queries by slug today (project layout, docs layout, chat layout, every leaf page) does NOT perform this fallback — folding it into the shared helper would change their behaviour (a stale slug would start silently redirecting somewhere it 404s today, or vice versa), which AS-025 forbids. The helper answers "does a workspace exist at this slug" and nothing more; the redirect decision is a policy that belongs to the one layout that has it, and F003 will keep it there unchanged when wiring that layout onto this helper.
- Used `getRequestClient()` from F001 (`lib/auth/current-user.ts`) inside the helper rather than calling `createClient()` directly, so the workspace lookup and the identity lookup share the same per-request memoised Supabase client instance rather than each constructing/memoising their own.
- Test strategy: per the spec's explicit `cache()` trap warning and F001's precedent, did NOT write a test asserting "two calls, one query" (that fails honestly under plain Vitest, which has no active per-request `cache()` dispatcher). Instead wrote four structural tests: (1) exactly one `cache()`-wrapped `getWorkspaceBySlug` is exported from the expected file; (2) its query body selects `"id, name, slug, logo_url"`, filters `.eq("slug", slug)`, and calls `.maybeSingle()`; (3) the function body does not reference `workspace_slug_history` (i.e. the redirect fallback was not folded in); (4) it imports and uses the shared `getRequestClient` from F001 rather than constructing its own client.
- What this test suite proves: the helper has the right shape (single cache-wrapped export, correct select/filter, no slug-history fallback baked in, shares F001's client). What it does NOT prove: that two calls within one real Next.js request actually collapse to one network round trip — same caveat as F001, and for the same reason (React's `cache()` + Next's per-request dispatcher aren't present under plain Vitest; see the header comment in `lib/auth/current-user.ts` this file's comment also references).

## Out-of-scope work needed
- F003/F007: swap the ~13 existing call sites (workspace layout, project layout, docs layout(s), chat layout, and every leaf page under `app/(workspace)/w/[workspaceSlug]/**` that queries `workspaces` by slug) over to import and call `getWorkspaceBySlug` from `@/lib/queries/workspaces` instead of building their own query. Not done here — this feature only creates the helper per its own spec ("This feature only creates the helper. F003 and F007 switch the call sites.").
- Not investigated: the `(portal)/portal/[workspaceSlug]/**` route tree also has its own ~18 call sites doing the identical `.eq("slug", workspaceSlug)` lookup. These were found by the same grep but are outside this feature's named scope (workspace layout / project layout / docs layouts named explicitly in the spec). Whoever picks up the portal side should confirm whether `getWorkspaceBySlug`'s column union (`id, name, slug, logo_url`) also covers every portal call site's select before reusing it there, or whether the portal needs its own pass.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the column union `id, name, slug, logo_url` (superset of every observed call site's select) rather than the narrowest common subset, per the spec's own instruction to do so when call sites differ. Documented the specific call sites and their selects in the file's doc comment and here so F003/F007 don't have to re-derive it.
AUTONOMOUS_DECISION: Kept the `workspace_slug_history` redirect fallback entirely out of the shared helper and left it as call-site logic for the one layout that has it. This is the "how" judgement call the spec explicitly delegated to the worker ("Decide deliberately whether that belongs inside your helper or stays at the call site, and write down why").

## Notes for the next worker
Call sites found with `.eq("slug", workspaceSlug)` under `app/(workspace)/w/[workspaceSlug]/**` (grep, `pm-app-perf` worktree, this commit):

- `app/(workspace)/w/[workspaceSlug]/layout.tsx` — select `id, name, slug, logo_url`; ALSO has the `workspace_slug_history` fallback + `permanentRedirect` branch. Keep that branch here, unchanged, when swapping the base lookup onto `getWorkspaceBySlug`.
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx` — select `id, name`
- `app/(workspace)/w/[workspaceSlug]/docs/layout.tsx` — select `id`
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/layout.tsx` — select `id`
- `app/(workspace)/w/[workspaceSlug]/chat/layout.tsx` — select `id`
- `app/(workspace)/w/[workspaceSlug]/page.tsx` — select `id, name` (inside a `Promise.all`)
- `app/(workspace)/w/[workspaceSlug]/projects/page.tsx` — select `id, name` (inside a `Promise.all`)
- Plus every other leaf page listed by `grep -rln '.eq("slug", workspaceSlug)' app/\(workspace\)` (approvals, archive, calendar, chat/page, docs/page, docs/[docId], my-tasks, notifications, preview-as-client, projects/[projectId]/board|docs/[docId]|docs/page|hours|list|print|settings/*, projects/page, requests, search, settings/*, t/[taskKey], team/*, templates, time/*, trash) — all currently duplicate this same query; each one is a candidate for F003/F007.

Exact import for F003/F007 to use:

```ts
import { getWorkspaceBySlug } from "@/lib/queries/workspaces";

const workspace = await getWorkspaceBySlug(workspaceSlug);
// workspace: { id, name, slug, logo_url } | null
```

- Returns `null` (not throwing) on "no row" or on a Supabase error (logs via `logger.error` internally, same fail-open convention as `getDefaultWorkspaceSlug` above it in the same file) — callers should keep whatever `if (!workspace) { notFound() / redirect(...) }` logic they already have; this helper does not change that contract, it just replaces the inline query.
- Do NOT expect this helper to perform the `workspace_slug_history` permanentRedirect fallback — only `app/(workspace)/w/[workspaceSlug]/layout.tsx` has that branch today, and it must keep it as its own follow-up query after `getWorkspaceBySlug` returns null, exactly as it does now (see this handoff's "Decisions made").
- `getWorkspaceBySlug` internally calls `getRequestClient()` (F001), not `createClient()` — no separate Supabase client construction per call site.
- No MCP tools were used for this feature (pure code change, no live schema/policy interaction — the `workspaces` table shape was confirmed by reading existing call sites in the repo, not via Supabase MCP).
