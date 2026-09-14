import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// status_set_v2 (20261125010000) seeds every new project with the 11
// v2-named default columns; the legacy four (todo / in_progress /
// in_review / done) no longer exist anywhere. Many integration suites
// predate that and use the legacy names as LITERAL column/status values
// in their assertions. Rather than rewriting every assertion, such a
// suite seeds the legacy four as the test project's own (PM-named)
// columns — exactly what a real workspace that kept the old names would
// look like — so exact-name lookups (createTask, moveTaskStatus, board
// queries) resolve without touching product code.
//
// Use AFTER the project row exists. Idempotent (upsert on
// (project_id, name)).
export async function seedLegacyStatusColumns(
  admin: SupabaseClient<Database>,
  projectId: string,
): Promise<void> {
  const { error } = await admin.from("project_statuses").upsert(
    [
      { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
      { project_id: projectId, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 200 },
      { project_id: projectId, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 300 },
      { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
    ],
    { onConflict: "project_id,name" },
  );
  if (error) {
    throw new Error(`seedLegacyStatusColumns(${projectId}): ${error.message}`);
  }
}

// For suites whose assertions need the project to contain ONLY a known
// column set (exact-order/exact-count assertions): prune every column
// whose name is not in `keep`. Never call with an empty `keep` — the
// prevent-last-delete trigger (and common sense) require at least one
// column to survive.
export async function pruneStatusColumnsExcept(
  admin: SupabaseClient<Database>,
  projectId: string,
  keep: string[],
): Promise<void> {
  if (keep.length === 0) throw new Error("keep must not be empty");
  const quoted = keep.map((n) => `"${n}"`).join(",");
  const { error } = await admin
    .from("project_statuses")
    .delete()
    .eq("project_id", projectId)
    .not("name", "in", `(${quoted})`);
  if (error) {
    throw new Error(`pruneStatusColumnsExcept(${projectId}): ${error.message}`);
  }
}
