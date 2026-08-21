# Handoff: F127 — single-source permissions module

## Status
COMPLETE

## Assertions covered
AS-230: PASS — `tests/unit/permissions.test.ts` (44 explicit, non-looped tests, no `for (const role of roles)`) covers every predicate exported from `lib/auth/permissions.ts` against every relevant role/context combination, including the read-only-role-overrides-ownership boundary case (viewer/guest cannot edit or delete even a resource they own) and the project-lead escalation boundary case (a plain "member" workspace role gains column-management and task-deletion rights only when `projectRole === "lead"`, and viewer/guest never gain them even as lead).

## Files changed
lib/auth/permissions.ts (new)
tests/unit/permissions.test.ts (new)

## Commands run
`npx vitest run tests/unit/permissions.test.ts` (0) — 44/44 passed
`npx tsc --noEmit` (0)
`npx eslint lib/auth/permissions.ts tests/unit/permissions.test.ts` (0)
`npx eslint .` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run test` (0 — vitest exits 0 even with failing tests in this repo's config) — 728 passed, 11 failed, 190 skipped across 142 files. All 11 failures are `Request rate limit reached` / 30s sign-in timeouts from Supabase Auth during test-user seeding in unrelated integration files (dependency-ui-actions, invite-member, remove-member, workspace-members-list, workspace-role-expansion) — the same shared-test-project rate-limit pattern the F126 handoff already documented as pre-existing and unrelated to code changes. `tests/unit/permissions.test.ts` (this feature's only new test file) is fully green.

## Decisions made
- Predicate names/signatures (the vocabulary future features F128/F129/F135/M12/M14 must reuse):
  - `PermissionContext = { role: WorkspaceRole; projectRole?: ProjectRole; resourceOwnerId?: string | null; callerId?: string | null }`
  - `WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "guest"` (matches F126's widened `workspace_members.role` domain)
  - `ProjectRole = "lead" | "member" | null` (matches `project_members.project_role`, F132)
  - `isResourceOwner(ctx): boolean`
  - `canManageProject(ctx): boolean` — owner/admin only
  - `canManageMembers(ctx): boolean` — owner/admin only
  - `canManageColumns(ctx): boolean` — owner/admin, or a member/lead whose `projectRole === "lead"`; viewer/guest never, even as lead
  - `canViewAudit(ctx): boolean` — owner/admin only
  - `canPurge(ctx): boolean` — owner only (irreversible, workspace-wide)
  - `canEditTask(ctx): boolean` — owner/admin/member; viewer/guest never, even if they own the task
  - `canDeleteTask(ctx): boolean` — owner/admin always; project lead always (within their project); plain member only for a task they created (`resourceOwnerId === callerId`); viewer/guest never, even if they own the task
- All predicates take one `PermissionContext` argument and return a plain `boolean` (not an error/typed-result type) — the clarification's "typed error or null rather than throwing" answer applies to *invalid* input, and every field here is a plain optional value with a safe default behaviour (missing `callerId`/`resourceOwnerId` simply evaluates to "not the owner," never throws), so no separate error channel was needed. This keeps the API the "small named functions with explicit return types" shape the clarification specified without inventing a Result<> wrapper this module doesn't need.
- No I/O, no React import, no Supabase client import — module only depends on its own types, per Round A Q10 of the clarification. Verified by inspection of the final file's imports (none).
- `require-membership.ts` already existed (from F126/earlier mission-1 work) and already covers the server-side "load real membership from the admin client" half of the story with its own owner/admin/member role set. It was read but intentionally left untouched: its `MembershipCheckResult.role` type is `"owner" | "admin" | "member"` (pre-F126, doesn't yet include `"viewer" | "guest"`), but widening that file is out of this feature's Touches (`lib/auth/permissions.ts`, `lib/auth/require-membership.ts` "if it doesn't already exist" — it does exist) and this feature's own clarification says permission checks stay in the *action layer* that calls the pure module, not inside the membership-loading helper. Flagged below as out-of-scope so the next worker who wires a Server Action through `canDeleteTask`/`canEditTask` etc. knows `requireActiveMembership`'s return type doesn't yet include viewer/guest.
- Task-deletion rule (member-can-delete-only-own-task, lead-can-delete-any-task-in-project) was not explicitly named in the spec's predicate list; derived from the spec's own instruction to design "predicates around" F126's role model plus the general principle (used elsewhere in this mission, e.g. F126's sole-owner guard) that destructive actions get a stricter check than routine edits. Recorded here per the ambiguity-resolution rule (simplest option, no new dependency, no second source of truth: reuses `isResourceOwner` rather than adding a new comparison).

## Out-of-scope work needed
- `lib/auth/require-membership.ts`'s `MembershipCheckResult.role` type and `requireActiveMembership`/`requireWorkspaceAdmin`/`requireWorkspaceOwner` still only recognize `"owner" | "admin" | "member"` — they predate F126's `viewer`/`guest` widening. Whichever feature first calls `canManageColumns`/`canEditTask`/etc. from a Server Action with a caller who could be `viewer` or `guest` will need to either widen this file's role union or load the role via a plain query instead. Left untouched here since it's outside this feature's file list and doesn't block the pure module itself.
- No wiring of `lib/auth/permissions.ts` into any existing Server Action or component yet — that's explicitly F128 (viewer-role-enforcement), F129 (role-management UI), and F135 (permission-aware UI gating)'s scope, not this feature's.
- `project_members.project_role` currently only has `"lead" | "member"` (per `supabase/migrations/20260821140520_project_members.sql`); if a future feature adds more granular project roles, `ProjectRole` and the predicates that branch on it will need updating.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the project-lead escalation explicitly in `canManageColumns` and `canDeleteTask` (rather than leaving `projectRole` unused) because the spec's `PermissionContext` shape names `projectRole` as an input, and a predicate that accepts a field it never reads would be a silent no-op / footgun for future callers who pass it expecting it to matter. Chose the narrowest plausible interpretation: lead escalation only where the action is naturally project-scoped (columns, task deletion), not for workspace-wide actions (`canManageProject`, `canManageMembers`, `canViewAudit`, `canPurge`) or plain task editing (already granted to any non-viewer/guest member).

## Notes for the next worker
- MCP: none used — this feature is pure logic with no live external state to introspect (per the spec's own "MCP at run: none" note and `worker-mcp-usage`'s guidance that pure-logic features need no MCP calls).
- Test file follows this repo's existing unit-test convention (`describe`/`it` blocks per predicate, explicit non-looped cases, `@vitest`/`node` environment, `@/` path alias) — same pattern as `tests/unit/attachment-list.test.ts` etc.
- If `npm run test`'s Supabase Auth rate-limit failures persist across sessions, that's a pre-existing shared-test-project issue documented independently in the F126 handoff; not something this feature introduced or should attempt to fix.
