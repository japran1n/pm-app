// F127 — single-source permissions module (AS-230: one permission helper
// backs both UI gating and the server-side re-check).
//
// Pure, side-effect-free predicates over a caller's already-loaded
// membership context. No I/O: callers (Server Actions, components) load
// `{ role, projectRole, resourceOwnerId, callerId }` themselves (e.g. via
// `lib/auth/require-membership.ts` on the server, or from already-fetched
// props on the client) and pass it in here. This module is imported by
// both the UI (to decide what to render/enable) and the Server Action
// layer (to re-check before mutating), so the two can never drift apart —
// that is the entire point of AS-230.
//
// Workspace roles (see supabase/migrations/*_workspace_members_role_expansion.sql,
// F126): "owner" | "admin" | "member" | "viewer" | "guest".
// Project roles (see supabase/migrations/20260821140520_project_members.sql,
// F132): "lead" | "member" | null (null = caller has no project_members row
// for the project in question, e.g. workspace-level member not added to
// this specific project).

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "guest";
export type ProjectRole = "lead" | "member" | null;

// The membership context every predicate below operates on. Callers pass
// only the fields relevant to the predicate; fields not needed by a given
// predicate may be omitted (typed as optional) so call sites don't have to
// fabricate values they don't have.
export interface PermissionContext {
  // The caller's workspace role. Required for every predicate — there is
  // no permission decision in this module that doesn't start from the
  // workspace role.
  role: WorkspaceRole;
  // The caller's role within the specific project the action targets, if
  // the action is project-scoped and the caller has a project_members row.
  // Undefined/null both mean "not an explicit project member"; callers
  // that don't yet know a project role (e.g. workspace-only actions) may
  // omit this field entirely.
  projectRole?: ProjectRole;
  // The user id of whoever owns/created the resource being acted on
  // (e.g. a task's creator, a comment's author). Omit for predicates that
  // don't need owner-vs-caller comparison.
  resourceOwnerId?: string | null;
  // The id of the user performing the action. Required whenever
  // `resourceOwnerId` is supplied, so ownership can be compared.
  callerId?: string | null;
}

// True when the caller is the same identity as the resource owner. Pure
// convenience used internally and exported since call sites need the same
// "did I create this" comparison elsewhere.
export function isResourceOwner(ctx: PermissionContext): boolean {
  if (!ctx.callerId || ctx.resourceOwnerId == null) return false;
  return ctx.callerId === ctx.resourceOwnerId;
}

// --- Workspace-level predicates ------------------------------------------

// Owner and admin manage workspace-wide settings (rename, delete, billing).
export function canManageProject(ctx: PermissionContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

// Inviting, removing, and changing the role of other members.
export function canManageMembers(ctx: PermissionContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

// Creating, renaming, reordering, or deleting board columns. Project leads
// (project-scoped) may also manage columns on the projects they lead, even
// if their workspace role is only "member".
export function canManageColumns(ctx: PermissionContext): boolean {
  if (ctx.role === "viewer" || ctx.role === "guest") return false;
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  return ctx.projectRole === "lead";
}

// Viewing the workspace members list and workspace settings pages (F134,
// AS-222). Every non-guest active member could already reach these pages
// under the pre-F134 behaviour (no page-level gate existed at all — see
// this predicate's call site); this only carves out "guest", which per
// AS-222 must be denied, not merely have controls hidden. Deliberately
// broader than `canManageMembers`/`canViewAudit` (which are the
// owner/admin-only *mutation*/audit gates) — a plain member can still see
// who else is in the workspace, just not invite/remove/change roles.
export function canViewMembersList(ctx: PermissionContext): boolean {
  return ctx.role !== "guest";
}

// Viewing the workspace audit log. Owner/admin only — this is
// deliberately narrower than `canManageMembers` because audit visibility
// is a read of potentially sensitive history, not a management action.
export function canViewAudit(ctx: PermissionContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

// Permanently purging soft-deleted data (e.g. emptying trash). Owner only
// — irreversible, workspace-wide destructive action.
export function canPurge(ctx: PermissionContext): boolean {
  return ctx.role === "owner";
}

// --- Generic write gate ----------------------------------------------------

// F128 (AS-216, AS-217): the single generic "is this caller allowed to
// write at all" predicate. Viewer is a read-only role by definition — no
// mutating Server Action (create/assign/move/reorder/tag/comment/attach/
// log-time/etc.) may proceed for a viewer, regardless of resource
// ownership. Every existing mutating Server Action re-checks this (or one
// of the more specific predicates below, where a specific predicate
// already encodes the same viewer-excluded rule plus extra nuance, e.g.
// `canDeleteTask`'s ownership scoping) at the top, so a direct call to the
// action (bypassing the UI entirely) is rejected server-side, not just
// hidden client-side.
//
// Deliberately does NOT exclude "guest" here: F128's scope is the viewer
// role specifically (see this feature's spec title). Guest write access is
// project-scoped and already governed by its own assertions (AS-223: "a
// guest can comment on and be assigned tasks inside a project they were
// added to") established by F134 — folding a blanket guest exclusion into
// this generic predicate would regress AS-223. A future feature that wants
// finer-grained guest write scoping (e.g. "guest can comment but not
// create tasks") should add a guest-aware predicate rather than widen this
// one, so this generic gate's contract stays exactly "viewer is
// read-only, every other role's existing write rules are unchanged."
export function canWrite(ctx: PermissionContext): boolean {
  return ctx.role !== "viewer";
}

// --- Task-level predicates -------------------------------------------------

// Editing a task's fields (title, description, status, assignee, etc).
// Viewers and guests never get write access regardless of ownership —
// their role is read-only by definition. Owner/admin/member can edit any
// task; project leads can edit tasks within their project even if their
// workspace role is "member" (already covered, member already qualifies),
// but a lead's edit rights don't extend beyond what "member" already
// grants, so no extra branch is needed here.
export function canEditTask(ctx: PermissionContext): boolean {
  if (ctx.role === "viewer" || ctx.role === "guest") return false;
  return ctx.role === "owner" || ctx.role === "admin" || ctx.role === "member";
}

// Deleting a task. Owner/admin may delete any task. A member may delete
// only a task they created (resourceOwnerId === callerId) — this is
// stricter than `canEditTask` on purpose: editing your own or a shared
// task is routine, but deleting is destructive, so a plain member is
// scoped to their own creations unless they're also the project lead.
// Viewer/guest can never delete, regardless of ownership.
export function canDeleteTask(ctx: PermissionContext): boolean {
  if (ctx.role === "viewer" || ctx.role === "guest") return false;
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  if (ctx.projectRole === "lead") return true;
  return isResourceOwner(ctx);
}

// --- Project-member-management predicates (F133) --------------------------

// Adding/removing a project's explicit member list rows. Mirrors
// `isProjectLeadOrWorkspaceAdmin` in lib/actions/project-members.ts (the
// actual server-side re-check, itself defense in depth on top of the
// `project_members_insert_leads_or_admins`/`..._delete_leads_or_admins`
// RLS policies from F132) — this predicate exists only so the settings
// page UI can hide/disable the add/remove controls the same way, per
// AS-230's single-source-of-truth convention. A workspace owner/admin may
// manage any project's members; an existing project lead may manage
// members of the project(s) they lead even at the workspace "member" role.
export function canManageProjectMembers(ctx: PermissionContext): boolean {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  return ctx.projectRole === "lead";
}

// Switching a project between "workspace" and "private" visibility.
// Owner/admin only — the real boundary is the DB-level
// `enforce_project_visibility_change_role` trigger (F132, AS-229); this
// predicate mirrors the same rule for UI gating. Deliberately narrower
// than `canManageProjectMembers` — a project lead can scope who has
// access via the member list, but changing the project's overall
// visibility policy is a workspace-level decision.
export function canChangeProjectVisibility(ctx: PermissionContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}
