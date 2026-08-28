import { logger } from "@/lib/observability/logger";

// F434-F440: read-side for workspace task types. RLS-respecting client —
// task_types_select_active_members already scopes rows to active
// workspace members.

import { createClient } from "@/lib/supabase/server";

export type TaskType = {
  id: string;
  name: string;
  color: string;
  position: number;
};

export async function getTaskTypes(workspaceId: string): Promise<TaskType[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("task_types")
    .select("id, name, color, position")
    .eq("workspace_id", workspaceId)
    .order("position");

  if (error) {
    logger.error("getTaskTypes failed", { error: error });
    return [];
  }

  return data ?? [];
}
