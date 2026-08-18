# Handoff: F081 — server action membership reguard

## Status
COMPLETE

## Assertions covered
AS-143: PASS — audited every exported Server Action in lib/actions/*.ts; all workspace-scoped mutations already re-check caller membership/role server-side via requireActiveMembership/requireWorkspaceAdmin/requireWorkspaceOwner (lib/auth/require-membership.ts), independent of RLS. No gap found; no code change was required. Full suite (418 tests, including the existing non-member/cross-workspace negative-case tests for each action) re-run as evidence — all pass.

## Audit table

| File | Exported action | Mutates workspace-scoped data? | Guard used | Location |
|---|---|---|---|---|
| workspaces.ts | createWorkspace | No (creates new workspace; caller is the future owner, nothing pre-existing to re-check) | N/A — uses `create_workspace_with_owner` RPC under caller's own session, not admin-bypass | — |
| workspaces.ts | inviteMember | Yes | requireWorkspaceAdmin | workspaces.ts:220 |
| workspaces.ts | revokeInvite | Yes | requireWorkspaceAdmin | workspaces.ts:411 |
| workspaces.ts | changeMemberRole | Yes (owner-only per AS-014/AS-019) | requireWorkspaceOwner | workspaces.ts:536 |
| workspaces.ts | removeMember | Yes | requireWorkspaceAdmin | workspaces.ts:670 |
| workspaces.ts | deleteWorkspace | Yes (owner-only) | requireWorkspaceOwner | workspaces.ts:831 |
| projects.ts | createProject | Yes | requireActiveMembership | projects.ts:78 |
| projects.ts | editProject | Yes | requireActiveMembership | projects.ts:215 |
| projects.ts | archiveProject | Yes (admin/owner-only per AS-030) | requireWorkspaceAdmin | projects.ts:379 |
| tasks.ts | createTask | Yes | requireActiveMembership | tasks.ts:118 |
| tasks.ts | assignTask | Yes | requireActiveMembership (caller) + requireActiveMembership (assignee, AS-052) | tasks.ts:311, 329 |
| tasks.ts | editTask | Yes | requireActiveMembership | tasks.ts:474 |
| tasks.ts | deleteTask | Yes | requireActiveMembership | tasks.ts:644 |
| tasks.ts | updateTaskTags | Yes | requireActiveMembership | tasks.ts:775 |
| tasks.ts | moveTaskStatus | Yes | requireActiveMembership | tasks.ts:911 |
| tasks.ts | reorderTask | Yes | requireActiveMembership | tasks.ts:1065 |
| tasks.ts | moveAndReorderTask | Yes (M6/M7 addition, checked as directed) | requireActiveMembership | tasks.ts:1217 |
| comments.ts | addComment | Yes | requireActiveMembership | comments.ts:102 |
| comments.ts | deleteComment | Yes (author or admin/owner) | requireWorkspaceAdmin (admin path) + requireActiveMembership (author path) | comments.ts:260, 275 |
| attachments.ts | uploadAttachment | Yes (M6/M7 addition, checked as directed) | requireActiveMembership | attachments.ts:131 |
| attachments.ts | getAttachmentSignedUrl | Read, not a mutation, but re-guarded anyway (AS-107 defense in depth) | requireActiveMembership | attachments.ts:303 |
| attachments.ts | deleteAttachment | Yes (M6/M7 addition, checked as directed) | requireActiveMembership (author path) + requireWorkspaceAdmin (admin path) | attachments.ts:453, 438 |
| auth.ts | signInWithMagicLink | No (not workspace-scoped) | N/A | — |
| auth.ts | signOut | No (not workspace-scoped) | N/A | — |
| invites.ts | activateInvitedMemberships | Writes workspace_members, but only ever activates rows keyed to the *already-authenticated* caller's own `userId`/`email` on sign-in (not attacker-controlled workspace/user input) — this function establishes membership, it isn't gated by pre-existing membership | N/A (uses row-id + `user_id IS NULL` claim guard instead, documented in file header) | invites.ts |

## Files changed
(none — audit found no gap; no source files modified)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unused-var warning in lib/queries/search.ts, unrelated to this feature)
`npm test` (0) — 79 test files, 418 tests passed, including existing non-member/cross-workspace negative tests for every action above
`npm run build` (0)

## Decisions made
- Treated `moveAndReorderTask`, `uploadAttachment`, and `deleteAttachment` (the M6/M7 actions flagged as time-pressure risks) with extra scrutiny — all three already call `requireActiveMembership` (and `deleteAttachment` additionally calls `requireWorkspaceAdmin` on the admin-override path). Confirmed no time-pressure gap materialized.
- `createWorkspace` and `activateInvitedMemberships` are correctly excluded from the AS-143 guard requirement: they don't re-check *pre-existing* membership because there is none to check (workspace creation happens under the caller's own RLS-scoped session via an RPC; invite activation is keyed to the authenticated caller's own identity, not attacker-supplied workspace/user IDs).
- `getAttachmentSignedUrl` is a read, not a mutation, so strictly outside AS-143's mutation-scoped wording, but it already carries the same guard (AS-107) — included in the table for completeness since the spec asked for every exported Server Action.
- No code changes made since the audit found every in-scope action already compliant with the `requireActiveMembership`/`requireWorkspaceAdmin`/`requireWorkspaceOwner` convention established by prior features (F010/F023 and friends).

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "every exported Server Action across lib/actions/*.ts" as including `invites.ts` and `auth.ts` (not explicitly named in the feature's file list) since the spec's Draft scope says "every mutating Server Action" — both were audited and found correctly out of AS-143's scope for the reasons above, rather than silently skipped.

## Notes for the next worker
The shared guard helpers live in `lib/auth/require-membership.ts` (`requireActiveMembership`, `requireWorkspaceAdmin`, `requireWorkspaceOwner`), all built on the admin (RLS-bypassing) Supabase client so the check can never be silently defeated by an incomplete RLS policy. Any new Server Action that mutates workspace-scoped data should call one of these three before touching data, matching the pattern already used in tasks.ts/projects.ts/comments.ts/attachments.ts/workspaces.ts.
