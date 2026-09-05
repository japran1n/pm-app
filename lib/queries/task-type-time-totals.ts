import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

// F116 (AS-062): thin read-side wrapper for rpc_project_time_totals —
// tracked and estimated minutes grouped by task type, for one project.
// RLS-respecting client: the RPC itself re-derives the caller's
// workspace/project access (same "database re-checks it too" convention
// every other project-scoped RPC in this schema follows), so this never
// needs the admin client.
export type ProjectTaskTypeTimeTotal = {
  taskTypeId: string;
  taskTypeName: string;
  systemKey: string | null;
  isBillable: boolean;
  trackedMinutes: number;
  estimatedMinutes: number;
};

export async function getProjectTaskTypeTimeTotals(
  projectId: string,
): Promise<ProjectTaskTypeTimeTotal[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("rpc_project_time_totals", {
    p_project_id: projectId,
  });

  if (error) {
    logger.error("getProjectTaskTypeTimeTotals failed", { error });
    return [];
  }

  return (data ?? []).map((row: NonNullable<typeof data>[number]) => ({
    taskTypeId: row.task_type_id,
    taskTypeName: row.task_type_name,
    systemKey: row.system_key,
    isBillable: row.is_billable,
    trackedMinutes: Number(row.tracked_minutes ?? 0),
    estimatedMinutes: Number(row.estimated_minutes ?? 0),
  }));
}
