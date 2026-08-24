// F221 (AS-403, AS-416): read path for a project's real board columns, in
// position order — the source the board (and, per F219, the settings
// columns page) render from, rather than a client-side fixed list.
//
// Mirrors getProjectBoardTasks's shape (lib/queries/tasks.ts): request-
// scoped, RLS-respecting client (`project_statuses`' existing `select`
// RLS from 20260824010000_project_statuses.sql, reusing
// `is_project_visible_to` -- nothing new here), one query, ordered by
// `position` ascending so AS-416 ("column order persists across reloads
// for all viewers") holds by construction: every reload re-reads the same
// DB rows in the same order, for every viewer, regardless of who last
// reordered them.

import { createClient } from "@/lib/supabase/server";

export type BoardColumnDef = {
  id: string;
  name: string;
  color: string;
  category: "not_started" | "in_progress" | "done";
  position: number;
};

export async function getProjectColumns(
  projectId: string,
): Promise<BoardColumnDef[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_statuses")
    .select("id, name, color, category, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    category: row.category as BoardColumnDef["category"],
    position: row.position,
  }));
}
