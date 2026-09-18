# Handoff: F13 — Server actions: `lib/actions/architecture/node-meta.ts`

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to F13 in the validation contract/plan (it is a pure server-action wiring feature consumed by later UI features). Definition-of-done checklist verified instead (see Commands run / Decisions made).

## Files changed
lib/actions/architecture/node-meta.ts
lib/actions/architecture.ts

## Commands run
`npx tsc --noEmit` (0)
`npm test` (0 — vitest run; 3738 passed, 180 pre-existing failures all in unrelated integration tests hitting `fetch failed` against a live Supabase endpoint, none reference node-meta/F13)
`git commit` (0)

## Decisions made
- Followed the clarified spec exactly: `setNodeMeta` upserts onto `architecture_node_meta` with `onConflict: 'task_id'`, normalizes keywords (trim, lowercase, dedup via `Set`, filter empty, slice to 30), and only calls `revalidatePath('/w', 'layout')` — no `revalidatePortalProject`.
- `setNodeMetaClientVisibility` performs the same upsert shape but only writes `client_visible`, and additionally calls `revalidatePortalProject(workspaceSlug, projectId)` since it affects portal visibility, per spec.
- Auth chain copied from `createSection`/`renameSection` in `sections.ts`: `getCurrentUser` → admin lookup of the task's project/workspace (never trust client-supplied ids) → `requireActiveMembership` → `canWrite`. Factored into a shared `resolveTaskAndAuthorizeWrite` helper local to `node-meta.ts` since both actions need the identical check; this is a private helper, not exported, so it doesn't change the module's public surface.
- Input validation uses `setNodeMetaSchema` / `setNodeMetaClientVisibilitySchema` from `lib/validation/architecture.ts` (built in F07) via `safeParse`, returning `MutationResult` with a user-facing error message on failure, matching the convention of other actions in this directory.
- `extractWorkspaceSlug` returns `string | undefined` (not `string | null`), so the shared helper's return type was typed accordingly to satisfy `tsc`.
- Re-exported both actions from the `lib/actions/architecture.ts` barrel, placed after `getNodeDetailsForToggle` per the spec's snippet.

## Out-of-scope work needed
None identified — this feature is a self-contained server-action module. UI wiring to call `setNodeMeta`/`setNodeMetaClientVisibility` belongs to later features per the mission plan.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No assertion IDs were listed in the F13 feature spec or matched in the plan for this feature; treated the "Definition of done" checklist in the spec as the acceptance criteria instead of per-assertion tests, since this is infrastructure consumed by later features that likely carry the user-facing assertions.

## Notes for the next worker
No MCP tools were needed for this feature — it only adds application-layer server actions against an already-existing `architecture_node_meta` table (created in an earlier migration feature) and does not touch live Supabase schema/policies.
