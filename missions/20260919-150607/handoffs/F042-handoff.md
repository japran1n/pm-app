# Handoff: F042 — changePageSlug action

## Status
PARTIAL

## Assertions covered
AS-138: PASS — `changePageSlug` is exported from `@/lib/actions/architecture` (barrel), verified by unit test.
AS-141: PASS — duplicate slug in the same project is rejected ("A page with this slug already exists."); same slug in a different project succeeds (uniqueness check is `.eq("project_id", ...).eq("page_slug", ...).neq("id", taskId)`).
AS-142: PASS — unauthenticated caller (`getCurrentUser()` returns no user) gets `{ success: false, error: "You must be signed in..." }`.
AS-143: PASS — viewer (`canWrite` false) gets `{ success: false, error: "Viewers don't have permission..." }`.
AS-149: PASS — successful call issues `admin.from("tasks").update({ page_slug: newSlug }).eq("id", taskId)` and calls `revalidatePath("/w", "layout")` (+ `revalidatePortalProject` when workspace slug resolves).

## Files changed
lib/actions/architecture/pages.ts
lib/actions/architecture.ts
tests/unit/m6-action-barrel-guard.test.ts
tests/unit/m7-change-page-slug.test.ts

## Commands run
`npx vitest run tests/unit/m7-change-page-slug.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (1 — 7/8 pass, see Blockers)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/architecture/pages.ts lib/actions/architecture.ts tests/unit/m7-change-page-slug.test.ts --max-warnings=0` (0)
`git commit` (0)

## Decisions made
- Implemented `changePageSlug` as a line-for-line structural mirror of `changePageKind` (same lookup shape, same membership/canWrite checks, same revalidate calls), per the clarified spec's "follow the exact pattern of changePageKind" instruction.
- Uniqueness check copies the exact query shape from `createPage`'s AS-017 check (`eq(project_id).eq(page_slug).neq(id, taskId).is(deleted_at, null).maybeSingle()`), scoped to same-project-only per AS-141.
- No slug normalization/parsing of `/`-nested paths — spec explicitly says the nested slug is written to `page_slug` verbatim, not parsed.
- Test file (`tests/unit/m7-change-page-slug.test.ts`) mocks `@/lib/supabase/admin`, `@/lib/supabase/server`, `@/lib/auth/require-membership`, `@/lib/auth/permissions`, and `@/lib/actions/portal-revalidate`, following the exact mock pattern of `tests/unit/f003-set-page-section-client-visibility-action.test.ts`. A generic recursive chain-builder mock (`buildSelectChain`) was needed because the task lookup and the uniqueness-check query share the same `select().eq()...` prefix but diverge at `.neq()`.

## Out-of-scope work needed
None beyond what F043 (tests) and F044 (UI) already own per the mission plan — no new work identified.

## Blockers
BLOCKER: `tests/unit/m6-action-barrel-guard.test.ts`'s second test ("every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests") now fails: `changePageSlug` is exported from the barrel (as F042 requires) but has zero callers in `app/`, `components/`, or `lib/` outside the leaf module and test files, because no UI wires it yet. This is confirmed pre-existing/green before this commit (verified via `git stash` + re-run) — it is not a regression in `changePageSlug`'s own logic, all 5 of which pass in isolation.
TRIED: Confirmed the failure is solely the barrel-guard's "real caller" scan (not a logic bug) by running `tests/unit/m7-change-page-slug.test.ts` alone (5/5 pass) and by running `m6-action-barrel-guard.test.ts` on the pre-F042 commit (2/2 pass, confirming the guard was green before this export existed). No allowlist/exemption mechanism exists in that guard file for actions pending UI wiring, and the feature spec explicitly scopes F042 to the action + barrel export only, with UI wiring deliberately deferred to F044-change-page-slug-ui.md (already planned in this same mission, sequenced right after F043).
NEEDED: F044 (already in plan.md, next in the F041→F042→F043→F044 chain) adds the UI caller (e.g. a slug editor component analogous to `PageKindSelector`) that imports and calls `changePageSlug` from the barrel. Once F044 lands, `m6-action-barrel-guard.test.ts` will go green again with no further changes needed here.
SUGGESTED FOLLOWUP: No new feature needed — F044-change-page-slug-ui.md already exists in the plan and is the correct next feature to run; it should be run immediately after F043 to close this gap. If the orchestrator's milestone validator runs before F044 completes, treat this specific guard failure as expected/transient for this milestone slice, not a regression to bounce back to F042.

## Autonomous decisions
AUTONOMOUS_DECISION: Left the barrel-guard "real reference" test's second sub-test red rather than adding an out-of-scope UI caller myself, since F044-change-page-slug-ui.md is a separate, already-planned feature and the F042 spec's "Touches" is limited to `lib/actions/architecture/pages.ts` + the barrel + the guard count. Writing UI code here would silently expand scope past what F042 asked for.

## Notes for the next worker
No MCP tools were used — this feature is pure application logic (Supabase admin client via the project's existing SDK pattern, not live schema/policy work), consistent with `worker-mcp-usage`'s decision tree (`Implement product API routes, components, business logic → No MCP`).

The full repo `npx vitest run` (no path filter) has 264/858 test files failing on this baseline commit, unrelated to this feature (e.g. `watching-feed-query.test.ts` failing on `supabase.rpc is not a function`) — this is pre-existing repo-wide flakiness/breakage, not caused by this change. Verification was scoped to the two test files named in this feature's Verification section, per instructions.
