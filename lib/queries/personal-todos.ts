// F416-F418: read-side for a caller's own personal to-dos. RLS
// (personal_todos_owner_only) already restricts every row to
// `user_id = auth.uid()` — no admin client, no extra filter needed here,
// same "RLS is the real boundary" convention as the rest of this schema.

import { createClient } from "@/lib/supabase/server";

export type PersonalTodo = {
  id: string;
  title: string;
  isDone: boolean;
  position: number;
};

export async function getPersonalTodos(
  workspaceId: string,
): Promise<PersonalTodo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("personal_todos")
    .select("id, title, is_done, position")
    .eq("workspace_id", workspaceId)
    .order("position");

  if (error) {
    console.error("getPersonalTodos failed:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    isDone: row.is_done,
    position: row.position,
  }));
}
