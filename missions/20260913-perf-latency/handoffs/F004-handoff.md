# Handoff: F004 — Thread user id into notification, favourite, and tour queries

## Status
COMPLETE

## Assertions covered
AS-004: PASS — the four remaining render-path `auth.getUser()` call sites named in the spec are gone. `lib/actions/onboarding-tour.ts`'s `getTourStatus()` and `writeTourCompletedAt()` now call `getCurrentUser()` from `@/lib/auth/current-user` instead of building their own `createClient()` + `auth.getUser()`. `lib/queries/notifications.ts`'s `getNotificationsForWorkspace()` does the same. `lib/queries/projects.ts`'s `getFavoriteProjectIds()` already accepted an optional `preloadedUserId` parameter; the workspace layout's call site now passes `user.id` (already resolved via `getCurrentUser()` earlier in the same render) instead of leaving it undefined, so that function's internal fallback `auth.getUser()` call is skipped entirely on the render path. Verified by: (1) `grep -n "auth.getUser()" lib/actions/onboarding-tour.ts lib/queries/notifications.ts` returning zero matches, (2) `bash missions/20260913-perf-latency/tools/test-gate.sh` passing with no new failures, (3) `npx tsc --noEmit` clean, (4) `npm run lint` at the same 0-errors/37-warnings baseline. Not verified as an actual single network round trip collapsing across all four (and the layout's) call sites within one real request — see "What this does not prove" below, same caveat F001–F003 documented.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
lib/actions/onboarding-tour.ts
lib/queries/notifications.ts

## Commands run
`npx tsc --noEmit` (0)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches accepted baseline)

## Decisions made
- Used option 1 (`getCurrentUser()`) for `onboarding-tour.ts` and `notifications.ts`, per the spec's stated default, since both files had no existing `preloadedUserId`-style parameter to reuse.
- Used option 2 for `getFavoriteProjectIds` since its signature already invited it (`preloadedUserId?: string`) — only changed the layout's call site to pass `user.id`, left the function itself untouched (spec: don't add required params, and this one already existed as optional).
- Fixed both `auth.getUser()` calls in `onboarding-tour.ts` (`getTourStatus` and `writeTourCompletedAt`), matching the spec's "2 calls" count for that file, even though only `getTourStatus` sits on the render path (the workspace layout calls it during render); `writeTourCompletedAt` backs the `dismissTour`/`replayTour` Server Actions. Both are small, safe, drop-in swaps to the shared cached helper with identical behaviour (same `{ supabase, user }` shape), so fixing both cost nothing extra and removed the now-unused `createClient` import cleanly.
- Removed the now-dead `createClient` import from `lib/actions/onboarding-tour.ts` and `lib/queries/notifications.ts` after both call sites in each file were switched, to avoid an unused-import lint warning.
- Did not touch `lib/queries/chat.ts`, `views.ts`, `profile.ts`, or `time-entries.ts` — reserved for F005 per the spec.
- Did not touch `lib/queries/projects.ts` itself (only its layout call site) — no signature change, no behaviour change to callers that still omit `preloadedUserId` (e.g. `projects/page.tsx`'s own call), preserving that page's own independent `auth.getUser()` fallback exactly as before (out of this feature's scope).

## Out-of-scope work needed
- `app/(workspace)/w/[workspaceSlug]/projects/page.tsx` calls `getFavoriteProjectIds(workspaceId)` without a preloaded id, so it still falls through to that function's internal `auth.getUser()` on that page's own request — that page is a separate render path from the layout and was not named in this feature's scope.
- The ~44 leaf-page/nested-layout call sites enumerated in F003's handoff (`page.tsx`, `settings/*`, `chat/*`, `docs/*`, `projects/[projectId]/**`, `time/*`, `team/*`, etc.) still each build their own `createClient()` + `auth.getUser()` independent of the layout's already-resolved identity. F005 and beyond, per F003's handoff.
- `lib/queries/chat.ts`, `views.ts`, `profile.ts`, `time-entries.ts` are explicitly F005's target per this feature's spec — left untouched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Fixed both `auth.getUser()` calls in `onboarding-tour.ts` (not just the render-path one), since the spec listed "2" as the call count for that file and both are trivial, behavior-preserving, same-pattern swaps. No ambiguity beyond that — followed the spec's stated default (option 1) and the existing optional-parameter shape (option 2) exactly as directed.

## Notes for the next worker
- Render-path `auth.getUser()` call count after this feature: the four call sites this feature targeted (`onboarding-tour.ts` x2, `notifications.ts` x1, and `projects.ts`'s `getFavoriteProjectIds` fallback, now skipped via the layout's passed-in id) are resolved. A repo-wide `grep -rln "auth.getUser()" app/'(workspace)'/w/'[workspaceSlug]'/ lib/` still returns ~90 files, but the overwhelming majority are Server Actions (`lib/actions/*.ts`, out of this mission's render-path scope per the spec) or the ~44 leaf pages/nested layouts under `app/(workspace)/w/[workspaceSlug]/**` that F003 already flagged as F005+ territory (e.g. `page.tsx`, `settings/*`, `chat/*`, `docs/*`, `projects/[projectId]/**`, `time/*`, `team/*`). `lib/queries/chat.ts`, `views.ts`, `profile.ts`, and `time-entries.ts` — explicitly F005's assigned files — still each have their own `auth.getUser()` and were deliberately left untouched here.
- `app/(workspace)/w/[workspaceSlug]/projects/page.tsx`'s own `getFavoriteProjectIds(workspaceId)` call (no preloaded id) was NOT changed — that page has its own render pass and its own `getCurrentUser()`-derived identity is not threaded into this call there. If a future feature targets that page, passing its own resolved user id through the same optional parameter is the same free win applied here to the layout.
- What this handoff's testing proves: the four call sites no longer construct their own client/call their own `auth.getUser()`; behaviour (return shapes, redirects, error handling) is byte-for-byte the same, just re-pointed at the shared cached helper or the already-resolved id. What it does NOT prove: that within one real Next.js request, `getCurrentUser()`'s memoised call actually collapses these four sites onto the exact same network round trip the layout already made — `cache()` does not memoise under plain Vitest (no per-request dispatcher), so no unit test in this repo can observe that dedup directly. This is guaranteed by React's `cache()` + Next's per-request context under the real runtime only, per `lib/auth/current-user.ts`'s own header comment and the same caveat F001–F003 documented.
- No MCP tools were used — pure application-code refactor of three files, no live schema/policy/config interaction.
