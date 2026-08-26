"use server";

// F416-F418: personal to-do mutations. No workspace-role check exists or
// is needed here — `personal_todos_owner_only`'s RLS policy (user_id =
// auth.uid(), no membership/admin branch) is the entire enforcement
// boundary, matching the "personal, not workspace, data" design this
// table's migration documents. Every action still runs through the
// request-scoped RLS-respecting client, never the admin client — there is
// no read this feature needs that bypasses a caller's own visibility.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  createPersonalTodoSchema,
  toggleTodoSchema,
  deleteTodoSchema,
} from "@/lib/validation/personal-todos";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type PersonalTodoActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createPersonalTodo(
  input: unknown,
): Promise<PersonalTodoActionResult> {
  const parsed = createPersonalTodoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: GENERIC_ERROR };

  const { data: existing } = await supabase
    .from("personal_todos")
    .select("position")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1000;

  const { error } = await supabase.from("personal_todos").insert({
    user_id: user.id,
    workspace_id: parsed.data.workspaceId,
    title: parsed.data.title,
    position: nextPosition,
  });

  if (error) {
    console.error("createPersonalTodo failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/my-tasks", "page");
  return { ok: true };
}

export async function toggleTodo(input: unknown): Promise<PersonalTodoActionResult> {
  const parsed = toggleTodoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("personal_todos")
    .update({ is_done: parsed.data.isDone })
    .eq("id", parsed.data.todoId);

  if (error) {
    console.error("toggleTodo failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/my-tasks", "page");
  return { ok: true };
}

export async function deleteTodo(input: unknown): Promise<PersonalTodoActionResult> {
  const parsed = deleteTodoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("personal_todos")
    .delete()
    .eq("id", parsed.data.todoId);

  if (error) {
    console.error("deleteTodo failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/my-tasks", "page");
  return { ok: true };
}
