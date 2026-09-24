import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { matchProjectStatusName } from "@/lib/tasks/status-category";

// Maps a requested status name (including the legacy defaults some create
// paths still send, e.g. createTaskSchema's "todo") onto the project's real
// column set. Matching rules live in `matchProjectStatusName`; null means
// nothing resolves and the caller decides how to fail.
export async function resolveProjectStatusName(
  admin: SupabaseClient<Database>,
  projectId: string,
  requestedName: string,
): Promise<string | null> {
  const { data: statuses } = await admin
    .from("project_statuses")
    .select("name, category, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  return matchProjectStatusName(requestedName, statuses ?? [])?.name ?? null;
}
