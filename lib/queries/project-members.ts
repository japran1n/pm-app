import { logger } from "@/lib/observability/logger";

// F133: data-fetching for the project settings/members panel
// (AS-225, AS-236).
//
// Uses the normal RLS-respecting client — `project_members_select_active_
// members` (supabase/migrations/20260821140520_project_members.sql) scopes
// rows to any active workspace member of the project's own workspace, which
// is exactly the audience allowed to see this panel at all. Name/email/
// avatar resolution reuses `resolvePeople` (lib/queries/people.ts), same
// batched-query convention as lib/queries/members.ts, so this stays a
// single query per list, no N+1 per row (this feature's performance
// budget).

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import { isProjectVisibleForRole } from "@/lib/actions/project-visibility";

export type ProjectMemberRow = {
  id: string;
  userId: string;
  projectRole: "lead" | "member";
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  addedByUserId: string | null;
  addedByName: string | null;
  createdAt: string;
};

// AS-236: the project members list shows each person's project role and
// who added them.
export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("project_members")
    .select("id, user_id, project_role, added_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("getProjectMembers: fetch failed", { error: error });
    throw error;
  }

  const ids = new Set<string>();
  for (const row of rows ?? []) {
    ids.add(row.user_id);
    if (row.added_by) ids.add(row.added_by);
  }

  const people = await resolvePeople(Array.from(ids));

  return (rows ?? []).map((row) => {
    const person = people.get(row.user_id);
    const adder = row.added_by ? people.get(row.added_by) : undefined;
    return {
      id: row.id,
      userId: row.user_id,
      projectRole: row.project_role as "lead" | "member",
      name: person?.name ?? null,
      email: person?.email ?? null,
      avatarUrl: person?.avatarUrl ?? null,
      addedByUserId: row.added_by,
      addedByName: adder ? adder.name ?? adder.email : null,
      createdAt: row.created_at,
    };
  });
}

export type AddableWorkspaceMember = {
  userId: string;
  name: string | null;
  email: string | null;
};

// Feeds the add-member picker: active workspace members who do not
// already have an explicit project_members row for this project (adding
// an already-explicit member would just hit the unique-constraint error
// the action already returns, but filtering here keeps the picker from
// offering a choice that's guaranteed to fail).
export async function getAddableWorkspaceMembers(
  workspaceId: string,
  projectId: string,
): Promise<AddableWorkspaceMember[]> {
  const supabase = await createClient();

  const [{ data: memberRows, error: memberError }, { data: existingRows, error: existingError }] =
    await Promise.all([
      supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId),
    ]);

  if (memberError) {
    logger.error("getAddableWorkspaceMembers: member fetch failed", { error: memberError });
    throw memberError;
  }
  if (existingError) {
    logger.error("getAddableWorkspaceMembers: existing-member fetch failed", { error: existingError });
    throw existingError;
  }

  const existingIds = new Set(
    (existingRows ?? []).map((row) => row.user_id).filter(Boolean) as string[],
  );

  const addableIds = (memberRows ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id) && !existingIds.has(id));

  const people = await resolvePeople(addableIds);

  return addableIds.map((userId) => ({
    userId,
    name: people.get(userId)?.name ?? null,
    email: people.get(userId)?.email ?? null,
  }));
}

export type VisibilityLossEntry = {
  userId: string;
  name: string | null;
  email: string | null;
};

// Computes who would lose access if a currently `'workspace'`-visible
// project were switched to `'private'` — the difference between "everyone
// who currently has workspace-wide access" and "everyone who has an
// explicit project_members row": an active member who can see the project
// under `isProjectVisibleForRole` while it is workspace-visible but not
// once it is private. Guests and clients never appear (their access is
// project_members-only either way). Deliberately safe to
// compute even when the project is already `'private'` (it would just
// describe who's excluded today) — the caller only surfaces this as a
// warning when switching *to* private.
export async function getVisibilityLossPreview(
  workspaceId: string,
  projectId: string,
): Promise<VisibilityLossEntry[]> {
  const supabase = await createClient();

  const [{ data: memberRows, error: memberError }, { data: explicitRows, error: explicitError }] =
    await Promise.all([
      supabase
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId),
    ]);

  if (memberError) {
    logger.error("getVisibilityLossPreview: member fetch failed", { error: memberError });
    throw memberError;
  }
  if (explicitError) {
    logger.error("getVisibilityLossPreview: explicit-member fetch failed", { error: explicitError });
    throw explicitError;
  }

  const explicitIds = new Set(
    (explicitRows ?? []).map((row) => row.user_id).filter(Boolean) as string[],
  );

  const losingIds = (memberRows ?? [])
    .filter((row) => {
      if (!row.user_id) return false;
      const rule = {
        role: row.role as WorkspaceRole,
        isProjectMember: explicitIds.has(row.user_id),
      };
      return (
        isProjectVisibleForRole({ ...rule, visibility: "workspace" }) &&
        !isProjectVisibleForRole({ ...rule, visibility: "private" })
      );
    })
    .map((row) => row.user_id as string);

  const people = await resolvePeople(losingIds);

  return losingIds.map((userId) => ({
    userId,
    name: people.get(userId)?.name ?? null,
    email: people.get(userId)?.email ?? null,
  }));
}
