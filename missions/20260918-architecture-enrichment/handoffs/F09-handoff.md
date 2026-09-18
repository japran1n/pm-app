# Handoff: F09 — Server Action `getNodeDetailsForToggle`

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to F09 in this mission (no `validation-contract.md` exists under `missions/20260918-architecture-enrichment/`, and F09's own spec has no assertion references, matching the precedent set in F07's handoff). Definition-of-done checklist items stand in for assertion coverage instead.

## Files changed
lib/actions/architecture/node-details.ts (new)
lib/actions/architecture.ts (barrel re-export added)

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Mirrored the exact auth chain from `lib/actions/architecture/sections.ts` (`createSection`/`setSectionClientVisibility`) rather than the spec's illustrative snippet, since the spec explicitly said "Check the existing action files ... to find the correct imports" and to "Mirror the exact import paths used in existing actions." Used `getCurrentUser` from `@/lib/auth/current-user` (not `@/lib/auth/session`), `requireActiveMembership` from `@/lib/auth/require-membership` with signature `(admin, workspaceId, userId)`, and `createAdminClient()` + a direct `projects` table lookup (`select("id, workspace_id, deleted_at, workspaces(slug)")`) instead of a nonexistent `getProjectByIdForMembership` helper — this matches the task instructions given directly to this worker over the illustrative spec snippet.
- Returned `{ ok: false, error: "Not found." }` for both "project not found" and "membership not active" cases, consistent with the `PortalQueryResult` error-shape convention already used by `setSectionClientVisibility` in the same file family (never leaking existence of a project the caller can't access).
- Returned `{ ok: false, error: "Forbidden." }` specifically for `role === 'client'`, per the clarified spec — client-role members never see discipline estimates, matching the three-layer protection documented at the top of `lib/queries/architecture-details.ts`.
- Called `getArchitectureNodeDetails(projectId)` directly and returned its result unchanged (no double-wrapping), since it already returns `PortalQueryResult<ArchitectureNodeDetails>`.

## Out-of-scope work needed
None identified. This feature is a thin, self-contained wrapper; nothing downstream was touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Deviated from the exact import paths shown in the spec's illustrative code snippet (`@/lib/auth/session`, `@/lib/auth/membership`, `@/lib/queries/projects`'s `getProjectByIdForMembership`) because none of those modules/exports exist in the repo. Instead followed the task instructions' explicit auth-chain description (getCurrentUser → createAdminClient project lookup → requireActiveMembership → role check) and the real import paths used by `lib/actions/architecture/sections.ts`, which the spec itself directed this worker to consult as the authoritative pattern.

## Notes for the next worker
- `getArchitectureNodeDetails` (lib/queries/architecture-details.ts, from F08) is team-only and must never be imported from any portal-facing file — this action is the sanctioned Client Component bridge for it.
- No test file was added because this mission has no assigned assertion IDs or test harness references for F09 in its spec/DoD; DoD items (use server directive, auth chain, barrel re-export, tsc pass) were verified manually via `tsc --noEmit` and code review.
