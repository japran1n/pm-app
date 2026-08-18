# Handoff: F082 — zod schemas all actions

## Status
COMPLETE

## Assertions covered
AS-146: PASS — audited every exported Server Action in lib/actions/*.ts; found one gap (getAttachmentSignedUrl used a bare `typeof` check instead of Zod) and fixed it by adding `getAttachmentSignedUrlSchema` (lib/validation/attachments.ts) and validating with `safeParse` before any database call. All other actions already validated via Zod before their first `.from(...)` call.
AS-160: PASS — grepped lib/, app/, components/ for `: any`, `as any`, `<any>`, `any[]` on any TypeScript code (not comments). Zero matches. No `any` escape hatches exist anywhere in the codebase; no fix was needed for this assertion.

## Files changed
lib/validation/attachments.ts
lib/actions/attachments.ts
missions/20260817-230717/handoffs/F082-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts:159)
`npm test` (0) — 79 test files, 418 tests, all passed
`npm run build` (0) — Next.js 16.3.1 production build succeeded

## Decisions made
- Added `getAttachmentSignedUrlSchema` (a UUID-validated `{ attachmentId }` object, same shape as `deleteAttachmentSchema`) rather than reusing `deleteAttachmentSchema` directly, so each action keeps its own named schema per this codebase's established one-schema-per-action convention (see lib/validation/attachments.ts, comments.ts, tasks.ts, workspaces.ts, projects.ts).
- Kept `getAttachmentSignedUrl`'s downstream code using the original `attachmentId` parameter (not `parsedInput.data.attachmentId`) since Zod validation here only asserts UUID *shape*, not a rewritten value — behavior is identical either way, and it minimizes the diff.
- Did not touch `lib/actions/invites.ts`'s `activateInvitedMemberships`: it has no `"use server"` directive, is never invoked as a form/client-bound Server Action, and is called only from the auth callback route with a server-verified `userId`/`email` pair (not raw client input). Treated as an internal server-side helper, not a "Server Action" for AS-146's purposes.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Scoped "every exported Server Action" to functions in `"use server"`-directive files (lib/actions/*.ts) that are actually invoked with client-originated input, per AS-146's own wording ("All Server Actions validate their input shape ... before touching the database"). `lib/actions/invites.ts` was excluded on this basis (see Decisions made).

## Notes for the next worker
Zod-coverage audit table (all functions in lib/actions/*.ts):

| File | Function | Zod schema | Validates before first DB call |
|---|---|---|---|
| attachments.ts | uploadAttachment | uploadAttachmentSchema | yes (pre-existing) |
| attachments.ts | getAttachmentSignedUrl | getAttachmentSignedUrlSchema | yes (added this feature) |
| attachments.ts | deleteAttachment | deleteAttachmentSchema | yes (pre-existing) |
| auth.ts | signInWithMagicLink | signInSchema | yes (pre-existing) |
| auth.ts | signOut | n/a (no input) | n/a |
| comments.ts | addComment | addCommentSchema | yes (pre-existing) |
| comments.ts | deleteComment | deleteCommentSchema | yes (pre-existing) |
| projects.ts | createProject | createProjectSchema | yes (pre-existing) |
| projects.ts | editProject | editProjectSchema | yes (pre-existing) |
| projects.ts | archiveProject | archiveProjectSchema | yes (pre-existing) |
| tasks.ts | createTask | createTaskSchema | yes (pre-existing) |
| tasks.ts | assignTask | assignTaskSchema | yes (pre-existing) |
| tasks.ts | editTask | editTaskSchema | yes (pre-existing) |
| tasks.ts | deleteTask | deleteTaskSchema | yes (pre-existing) |
| tasks.ts | updateTaskTags | updateTaskTagsSchema | yes (pre-existing) |
| tasks.ts | moveTaskStatus | moveTaskStatusSchema | yes (pre-existing) |
| tasks.ts | reorderTask | reorderTaskSchema | yes (pre-existing) |
| tasks.ts | moveAndReorderTask | moveAndReorderTaskSchema | yes (pre-existing) |
| workspaces.ts | createWorkspace | createWorkspaceSchema | yes (pre-existing) |
| workspaces.ts | inviteMember | inviteMemberSchema | yes (pre-existing) |
| workspaces.ts | revokeInvite | revokeInviteSchema | yes (pre-existing) |
| workspaces.ts | changeMemberRole | changeMemberRoleSchema | yes (pre-existing) |
| workspaces.ts | removeMember | removeMemberSchema | yes (pre-existing) |
| workspaces.ts | deleteWorkspace | deleteWorkspaceSchema | yes (pre-existing) |
| invites.ts | activateInvitedMemberships | n/a — internal helper, no `"use server"`, not client-invoked | out of scope, see Decisions made |

`any`-type audit: `grep -rnE '(:\s*any\b|as\s+any\b|<any>|any\[\])' lib app components --include="*.ts" --include="*.tsx"` returned zero matches on actual type positions (only the English word "any" inside comments matched a looser pattern, e.g. "any active workspace member", "any existing row" — not type annotations). No fixes were needed for AS-160.
