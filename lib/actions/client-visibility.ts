"use server";

// C2 team-side half (docs/client-portal-plan.md): the control that decides
// what a client actually sees.
//
// The migration made `tasks.client_visible` default false, which is the
// safe default but also means the column is inert until the team has a way
// to flip it. This is that way. Without it the feature is only reachable
// through SQL, which is not a feature.
//
// Same shape as every other mutating action in this codebase (see
// lib/actions/watchers.ts): Zod-validated input, the owning workspace
// resolved server-side from the task rather than trusted from the client,
// membership and permission re-checked here as defense in depth on top of
// RLS, generic user-facing errors with detail logged server-side only.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canEditTask } from "@/lib/auth/permissions";

const setTaskClientVisibilitySchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  visible: z.boolean(),
});

export type SetTaskClientVisibilityResult =
  | { ok: true; data: { taskId: string; clientVisible: boolean } }
  | { ok: false; error: string };

export async function setTaskClientVisibility(
  taskId: string,
  visible: boolean,
): Promise<SetTaskClientVisibilityResult> {
  const parsed = setTaskClientVisibilitySchema.safeParse({ taskId, visible });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, projects!inner(workspace_id)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return { ok: false, error: "Task not found." };
  }

  // Sharing work with an outside party is an edit to the task, so it takes
  // the same permission editing it does — deliberately not a looser gate.
  // `canEditTask` already denies viewer, guest and client, so a client can
  // never widen their own visibility even if they reached this action.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to change what the client sees.",
    };
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ client_visible: parsed.data.visible })
    .eq("id", parsed.data.taskId);

  if (updateError) {
    console.error("setTaskClientVisibility: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  revalidatePath("/w", "layout");

  return {
    ok: true,
    data: { taskId: parsed.data.taskId, clientVisible: parsed.data.visible },
  };
}
