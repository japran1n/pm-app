"use client";

// F135 (AS-231): membership context provider. The workspace layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) already resolves the
// caller's workspace role and per-project roles once, server-side, for the
// active workspace — this Client Component context makes that same
// already-fetched membership available to any client component further
// down the tree WITHOUT re-fetching it and WITHOUT that component's
// immediate parent having to thread `currentUserRole`/`currentUserRole`
// props through every intermediate layer.
//
// This is deliberately a thin data carrier, not a second permission
// implementation: every predicate that decides what a given role/
// projectRole combination may do still lives in lib/auth/permissions.ts
// (F127) — components read `role`/`projectRoles` from this context and
// pass them into those predicates themselves, exactly like a component
// that received the same fields as explicit props would. See that file's
// own header comment for why UI gating and the server-side re-check must
// share one source of truth (AS-230).
//
// This does NOT replace props like TaskDetailSheet's own `currentUserRole`
// (sourced fresh from getTaskDetail alongside the task itself, needed
// exactly once per open) or CommentList/AttachmentList/TimeTracking's own
// `currentUserRole` prop (threaded down from TaskDetailSheet, matching
// their pre-existing convention). This context exists for components that
// have no such caller-supplied prop available at all — e.g. a table row's
// inline status Select rendered straight from the initial (Server
// Component) list/board fetch, which never receives a per-row role prop
// and previously had no way to know the caller's role short of a second
// per-row fetch.

import { createContext, useContext } from "react";

import type { ProjectRole, WorkspaceRole } from "@/lib/auth/permissions";

export type MembershipContextValue = {
  /** C2: whether the ACTIVE workspace has at least one active member with
   * the `client` role. Client-portal affordances (e.g. the task sheet's
   * "share with client" toggle) are hidden entirely when it does not —
   * a control implying an audience that does not exist is worse than no
   * control. Server-fetched once in the workspace layout alongside the
   * caller's own role, never a per-component query. */
  hasClient: boolean;
  /** The caller's workspace role in the ACTIVE workspace (the one the
   * current /w/[workspaceSlug] route is under). */
  role: WorkspaceRole;
  /** projectId -> the caller's role on that project, for every project in
   * the active workspace the caller has an explicit project_members row
   * for. A project id absent from this map means "no explicit project
   * membership" — same meaning as `ProjectRole`'s `null` case (F127's own
   * doc comment on `PermissionContext.projectRole`), just represented as a
   * missing key instead of an explicit null entry, so callers use
   * `projectRoles[projectId] ?? null` when passing it into a
   * PermissionContext. */
  projectRoles: Record<string, ProjectRole>;
};

// `null` default (no provider in the tree) rather than throwing — this
// matches the rest of the codebase's "an absent/undefined caller-role prop
// is treated as permissive" convention (see CommentList/TimeTracking's own
// `currentUserRole ? canWrite(...) : true` fallback), so a component that
// consumes this context still renders sensibly in isolation (e.g. an
// existing unit test that mounts it without wrapping it in
// <MembershipProvider>) instead of crashing.
const MembershipContext = createContext<MembershipContextValue | null>(null);

export function MembershipProvider({
  role,
  hasClient = false,
  projectRoles,
  children,
}: {
  role: WorkspaceRole;
  hasClient?: boolean;
  projectRoles: Record<string, ProjectRole>;
  children: React.ReactNode;
}) {
  return (
    <MembershipContext.Provider value={{ role, hasClient, projectRoles }}>
      {children}
    </MembershipContext.Provider>
  );
}

// Returns `null` when rendered outside a <MembershipProvider> — callers
// are expected to treat that the same way they already treat a missing
// `currentUserRole` prop elsewhere in this codebase (permissive default),
// never as "definitely has no access".
export function useMembership(): MembershipContextValue | null {
  return useContext(MembershipContext);
}

/** Convenience: this project's role for the caller, or null if they have
 * no explicit project_members row for it (or there's no provider at all). */
export function useProjectRole(projectId: string | undefined): ProjectRole {
  const membership = useMembership();
  if (!membership || !projectId) return null;
  return membership.projectRoles[projectId] ?? null;
}
