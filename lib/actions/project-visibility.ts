import type { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceRole } from "@/lib/auth/permissions";

export type ProjectVisibility = "workspace" | "private";

type AdminClient = ReturnType<typeof createAdminClient>;

// The application-side copy of `public.is_project_visible_to`
// (supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql).
// Admin-client reads and writes bypass RLS, so every one of them re-runs
// this rule; it is the only TS implementation and must match the SQL for
// every role. For an active workspace member:
//   - an explicit project_members row always grants visibility;
//   - guest and client see nothing else;
//   - owner and admin see every project;
//   - member and viewer see workspace-visible projects.
// Active membership itself is the caller's responsibility (every call site
// has already run requireActiveMembership).
export function isProjectVisibleForRole(input: {
  role: WorkspaceRole;
  visibility: ProjectVisibility;
  isProjectMember: boolean;
}): boolean {
  if (input.isProjectMember) return true;
  if (input.role === "guest" || input.role === "client") return false;
  if (input.role === "owner" || input.role === "admin") return true;
  return input.visibility === "workspace";
}

// True when the answer for this role/visibility depends on a
// project_members row, i.e. a lookup is needed before deciding.
export function needsProjectMembershipLookup(
  role: WorkspaceRole,
  visibility: ProjectVisibility,
): boolean {
  return !isProjectVisibleForRole({ role, visibility, isProjectMember: false });
}

export async function isProjectVisibleToCaller(
  admin: AdminClient,
  context: { projectId: string; visibility: ProjectVisibility },
  userId: string,
  role: WorkspaceRole,
): Promise<boolean> {
  if (!needsProjectMembershipLookup(role, context.visibility)) return true;

  const { data } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", context.projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!data;
}

// Batch form for one caller across many projects (possibly in different
// workspaces, hence the per-project role): returns the ids the caller can
// see, with a single project_members query covering only the projects
// whose answer depends on it.
export async function filterProjectsVisibleToCaller(
  admin: AdminClient,
  userId: string,
  projects: Array<{
    projectId: string;
    visibility: ProjectVisibility;
    role: WorkspaceRole;
  }>,
): Promise<Set<string>> {
  const visible = new Set<string>();
  const lookup = new Set<string>();
  for (const { projectId, visibility, role } of projects) {
    if (needsProjectMembershipLookup(role, visibility)) lookup.add(projectId);
    else visible.add(projectId);
  }

  if (lookup.size > 0) {
    const { data, error } = await admin
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .in("project_id", [...lookup]);
    if (error) throw error;
    for (const row of data ?? []) visible.add(row.project_id as string);
  }

  return visible;
}

// Batch form for many users on one project: returns the subset of
// `roleByUserId` (active workspace members only) who can see the project.
export async function filterUsersWhoCanSeeProject(
  admin: AdminClient,
  project: { projectId: string; visibility: ProjectVisibility },
  roleByUserId: Map<string, WorkspaceRole>,
): Promise<Set<string>> {
  const visible = new Set<string>();
  const lookup: string[] = [];
  for (const [userId, role] of roleByUserId) {
    if (needsProjectMembershipLookup(role, project.visibility)) lookup.push(userId);
    else visible.add(userId);
  }

  if (lookup.length > 0) {
    const { data, error } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", project.projectId)
      .in("user_id", lookup);
    if (error) throw error;
    for (const row of data ?? []) visible.add(row.user_id as string);
  }

  return visible;
}
