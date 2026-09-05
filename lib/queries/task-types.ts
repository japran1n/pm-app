import { logger } from "@/lib/observability/logger";

// F434-F440: read-side for workspace task types. RLS-respecting client —
// task_types_select_active_members already scopes rows to active
// workspace members.

import { createClient } from "@/lib/supabase/server";

// F005b (missions/20260903-portal): `systemKey` is the stable identifier
// a type ROW can optionally carry (currently only `page`, matched by
// `getPortalPages`) independent of its human-editable `name` — surfaced
// here so the settings screen can show which types the portal depends
// on without a second query.
export type TaskType = {
  id: string;
  name: string;
  color: string;
  position: number;
  systemKey: string | null;
  // F116: whether time against this type is normally billable — fixed
  // (not workspace-editable) on any system-keyed row, per
  // task_types_lock_system_flags_trigger.
  isBillable: boolean;
};

export async function getTaskTypes(workspaceId: string): Promise<TaskType[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("task_types")
    .select("id, name, color, position, system_key, is_billable")
    .eq("workspace_id", workspaceId)
    .order("position");

  if (error) {
    logger.error("getTaskTypes failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    systemKey: row.system_key,
    isBillable: row.is_billable,
  }));
}
