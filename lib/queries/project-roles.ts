import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeople } from "@/lib/queries/people";
import type { PortalQueryResult } from "@/lib/queries/portal";

// Data-fetching for F112's `project_roles` (missions/20260903-portal,
// six-star review Part 0/D): who does what JOB on a project (PM, team
// lead, design lead, Webflow lead, designer, developer) — separate from
// `project_members.project_role` (a permission, `lead`|`member`) and from
// `project_decision_owners` (who has authority over a decision type,
// lib/queries/approvals.ts). See this feature's own migration
// (20261101010000_f112_project_roles.sql) for the full "why two tables"
// rationale.
//
// Vocabulary/labels/row types live in lib/project-roles-shared.ts, NOT
// here — this module imports `@/lib/supabase/server`
// (`createClient`/`createAdminClient`), which resolves to `next/headers`,
// a server-only API. The settings editor
// (components/project/project-roles.tsx) is a Client Component that
// needs the labels/types but must never pull that import in — see this
// feature's own handoff for the concrete request-time 500 this caused
// before the split, and tests/unit/server-client-boundary-imports.test.ts.
export {
  PROJECT_ROLE_VALUES,
  PROJECT_ROLE_ORDER,
  PROJECT_ROLE_LABELS,
  type ProjectRoleValue,
  type ProjectRoleRow,
  type ProjectTeamCandidate,
} from "@/lib/project-roles-shared";
import type { ProjectRoleValue, ProjectRoleRow, ProjectTeamCandidate } from "@/lib/project-roles-shared";

export async function getProjectRoles(
  projectId: string,
): Promise<PortalQueryResult<ProjectRoleRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_roles")
    .select("id, user_id, role, note")
    .eq("project_id", projectId);

  if (error) {
    logger.error("getProjectRoles: failed to load project roles", { error });
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: true, data: [] };

  const userIds = [...new Set(data.map((row) => row.user_id))];
  const people = await resolvePeople(userIds);

  return {
    ok: true,
    data: data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role as ProjectRoleValue,
      note: row.note,
      name: people.get(row.user_id)?.name ?? null,
      email: people.get(row.user_id)?.email ?? null,
      avatarUrl: people.get(row.user_id)?.avatarUrl ?? null,
    })),
  };
}

// Same "read through the admin client, exclude anyone whose workspace
// role is `client`" shape `getPortalTeam` uses — this is a settings-page
// picker, not a client-facing surface, but the audience it should offer
// (agency team members already explicit on this project) is identical.
export async function getProjectTeamCandidates(
  workspaceId: string,
  projectId: string,
): Promise<ProjectTeamCandidate[]> {
  const admin = createAdminClient();

  const { data: members, error } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);

  if (error) {
    logger.error("getProjectTeamCandidates: failed to load project members", { error });
    return [];
  }
  if (!members?.length) return [];

  const userIds = [...new Set(members.map((m) => m.user_id))];

  const [people, roleRows] = await Promise.all([
    resolvePeople(userIds),
    admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .in("user_id", userIds),
  ]);

  const roleByUserId = new Map((roleRows.data ?? []).map((r) => [r.user_id, r.role]));

  return userIds
    .filter((userId) => roleByUserId.get(userId) !== "client")
    .map((userId) => ({
      userId,
      name: people.get(userId)?.name ?? null,
      email: people.get(userId)?.email ?? null,
      avatarUrl: people.get(userId)?.avatarUrl ?? null,
    }));
}
