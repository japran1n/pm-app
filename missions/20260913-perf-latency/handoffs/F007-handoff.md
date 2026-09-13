# Handoff: F007 — Project and docs layouts use the cached helpers

## Status
COMPLETE

## Assertions covered
AS-002: PASS — `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx`, `app/(workspace)/w/[workspaceSlug]/docs/layout.tsx`, `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/layout.tsx`, and `app/(workspace)/w/[workspaceSlug]/chat/layout.tsx` no longer build their own `createClient()` + `.from("workspaces").eq("slug", ...)` query; all four now call the shared `getWorkspaceBySlug(workspaceSlug)` from `@/lib/queries/workspaces` (F002). The three that also called `supabase.auth.getUser()` directly (docs layout, project/docs layout, chat layout) now call `getCurrentUser()` from `@/lib/auth/current-user` (F001) instead. Verified by reading the diff (no `createClient`/raw `.from("workspaces")...eq("slug"` reference left in any of the four files — confirmed via `grep -n "supabase\|createClient"` returning zero matches in all four), and by the full gate run passing. Not verified as an actual single network round trip across nested layouts within one real request — `cache()` doesn't memoise under plain Vitest (same caveat as F001/F002/F003).

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx
app/(workspace)/w/[workspaceSlug]/docs/layout.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/layout.tsx
app/(workspace)/w/[workspaceSlug]/chat/layout.tsx

## Commands run
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches accepted baseline)
`npx tsc --noEmit` (0, no output)

## Decisions made
- `projects/[projectId]/layout.tsx` previously selected `id, name` from `workspaces` but only ever read `workspace.id`. `getWorkspaceBySlug`'s superset shape (`id, name, slug, logo_url`) satisfies that read; nothing in this file used `workspace.name`, so swapping in the shared helper changes nothing observable. Auth was already deferred to the parent layout here (no `getUser()` call existed in this file before), so no `getCurrentUser()` call was added — kept that as-is.
- `docs/layout.tsx` and `projects/[projectId]/docs/layout.tsx` each had their own `redirect("/sign-in")` guard on missing user and `redirect("/onboarding")` guard on missing workspace — kept both guards and their exact redirect targets unchanged, just re-pointed the two lookups at `getCurrentUser()` / `getWorkspaceBySlug()`.
- `chat/layout.tsx`: kept its own ordering (workspace lookup first, then user lookup) and its `redirect(`/w/${workspaceSlug}`)` on missing workspace exactly as before — that layout does not redirect on missing user at all (children handle that), so no new guard was introduced. Left `getWorkspaceChannels` / `getDmCandidates` calls completely untouched, per the spec's explicit F008 carve-out.
- Did not touch any leaf page under these layouts — the spec named only the four layout files, and F002's survey lists the leaf pages that still repeat the lookup as separate out-of-scope work, not this feature's job to sweep.

## Out-of-scope work needed
- Every leaf page nested under these four layouts still performs its own `createClient()` + `.eq("slug", workspaceSlug)` and/or `auth.getUser()` call — e.g. `projects/[projectId]/list/page.tsx`, `board/page.tsx`, `hours/page.tsx`, `print/page.tsx`, `settings/*`, `docs/[docId]/page.tsx`, `docs/page.tsx`, `chat/page.tsx`, `chat/[channelId]/page.tsx`, etc. F002's handoff already enumerates the full leaf-page list under "Notes for the next worker" — none of them were named in this feature's `Files:` field, so none were changed here, per the spec's "do not go hunting beyond what that survey already mapped" instruction.
- The `(portal)/portal/[workspaceSlug]/**` route tree's ~18 parallel call sites remain untouched (flagged by F002 and F003 as a separate, un-scoped pass).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — followed F002/F003's established pattern directly; no ambiguity encountered)

## Notes for the next worker
- Slug lookups remaining per request on the `/w/<slug>/projects/<id>/list` path after this feature: **one**, in `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx` (line ~120, its own `.eq("slug", workspaceSlug)` against a locally-constructed client). The chain for that route is: top-level workspace layout (F003, already on `getWorkspaceBySlug`/`getCurrentUser`) → `projects/[projectId]/layout.tsx` (this feature, now on `getWorkspaceBySlug`) → `list/page.tsx` (untouched, still does its own raw lookup). Under the real Next.js runtime this would collapse into the same memoised `cache()` call as the two layout calls once `list/page.tsx` is swapped over too — that swap is out of scope here and is the natural next follow-up (leaf-page sweep) per F002/F003's notes.
- What this handoff's testing proves: all four named layouts no longer construct their own Supabase client or run a raw `.eq("slug", ...)` / `auth.getUser()` query; each keeps its pre-existing guard behaviour (redirect targets, 404s) byte-for-byte, verified by reading the diff line-by-line against the pre-change file and by `tsc`/lint/test-gate all passing. What it does NOT prove: that within one real Next.js request, these layouts' `getWorkspaceBySlug`/`getCurrentUser` calls actually collapse into a single network round trip with the parent workspace layout's calls — `cache()` does not memoise under plain Vitest, so no unit test in this repo can observe that dedup directly; it is guaranteed by React's `cache()` + Next's per-request dispatcher under the real runtime only (same caveat documented in F001/F002/F003's handoffs).
- No MCP tools were used for this feature — pure code refactor of four files, no live schema/policy interaction, no new database object touched.
