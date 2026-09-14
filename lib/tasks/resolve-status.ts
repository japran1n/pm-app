import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// status_set_v2 (supabase/migrations/20261125010000_status_set_v2.sql)
// renamed the legacy four default columns on EVERY project (todo -> To
// Do, in_progress -> In Dev, in_review -> QA by Dev, done -> Completed),
// but several create paths still default to the legacy "todo" name
// (createTaskSchema's AS-045 default, templates' `?? "todo"`,
// RECURRENCE_INITIAL_STATUS). This helper is the single place that maps
// a LEGACY default name onto the project's real column set:
//
//   1. exact name exists on the project -> returned unchanged;
//   2. legacy name -> its v2 rename, when that column exists;
//   3. otherwise -> the project's lowest-position not_started column;
//   4. null when nothing resolves (caller decides how to fail).
//
// A CUSTOM (non-legacy) name that doesn't exist resolves to null via
// step 1 failing and step 2 not applying — callers keep AS-479's
// "stale/forged column names hard-fail" behavior for those.
const LEGACY_STATUS_MAP: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Dev",
  in_review: "QA by Dev",
  done: "Completed",
};

export async function resolveProjectStatusName(
  admin: SupabaseClient<Database>,
  projectId: string,
  requestedName: string,
): Promise<string | null> {
  const { data: exact } = await admin
    .from("project_statuses")
    .select("name")
    .eq("project_id", projectId)
    .eq("name", requestedName)
    .maybeSingle();
  if (exact) return exact.name;

  const mappedName = LEGACY_STATUS_MAP[requestedName];
  if (!mappedName) return null;

  const { data: mapped } = await admin
    .from("project_statuses")
    .select("name")
    .eq("project_id", projectId)
    .eq("name", mappedName)
    .maybeSingle();
  if (mapped) return mapped.name;

  const { data: firstColumn } = await admin
    .from("project_statuses")
    .select("name")
    .eq("project_id", projectId)
    .eq("category", "not_started")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return firstColumn?.name ?? null;
}
