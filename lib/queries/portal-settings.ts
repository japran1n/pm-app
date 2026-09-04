import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

// F080 (missions/20260903-portal, hardening): the "Client portal"
// settings panel's readiness checklist. Turning the portal on for a
// project with no client member, no phase, and no client-visible task
// shows the client an empty shell, which is worse than off (this
// feature's own clarified spec) — so the settings panel shows these
// three facts beside the enable control rather than gating the control
// itself (a PM may have a legitimate reason to flip it on early, e.g.
// staging a client invite before the first phase exists; this is
// informational, not a hard block).
export type PortalReadiness = {
  hasClientMember: boolean;
  hasPhase: boolean;
  hasClientVisibleTask: boolean;
};

const EMPTY_READINESS: PortalReadiness = {
  hasClientMember: false,
  hasPhase: false,
  hasClientVisibleTask: false,
};

export async function getPortalReadiness(projectId: string): Promise<PortalReadiness> {
  const supabase = await createClient();

  // "Has a client member" = a `project_members` row whose user is a
  // workspace-level `client` (client-hood is a workspace role, per
  // lib/auth/permissions.ts's own doc comment; project_members only
  // scopes an existing workspace member to a specific project) — so this
  // reads project_members and cross-checks each user's workspace role,
  // same two-table shape lib/queries/approvals.ts's
  // getProjectClientMembers already uses at the workspace level.
  const [membersResult, phasesResult, tasksResult] = await Promise.all([
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase
      .from("project_phases")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("client_visible", true)
      .is("deleted_at", null),
  ]);

  if (membersResult.error || phasesResult.error || tasksResult.error) {
    logger.error("getPortalReadiness: failed to load readiness facts", {
      membersError: membersResult.error,
      phasesError: phasesResult.error,
      tasksError: tasksResult.error,
    });
    return EMPTY_READINESS;
  }

  let hasClientMember = false;
  const memberIds = [...new Set((membersResult.data ?? []).map((row) => row.user_id))];
  if (memberIds.length > 0) {
    const { data: clientRows, error: clientError } = await supabase
      .from("workspace_members")
      .select("user_id")
      .in("user_id", memberIds)
      .eq("role", "client")
      .eq("status", "active");

    if (clientError) {
      logger.error("getPortalReadiness: failed to resolve client roles", { error: clientError });
    } else {
      hasClientMember = (clientRows ?? []).length > 0;
    }
  }

  return {
    hasClientMember,
    hasPhase: (phasesResult.count ?? 0) > 0,
    hasClientVisibleTask: (tasksResult.count ?? 0) > 0,
  };
}
