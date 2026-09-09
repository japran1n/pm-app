"use server";

import { revalidatePath } from "next/cache";
import { updateTaskTagsSchema } from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";

export type UpdateTaskTagsResult =
  | {
      ok: true;
      data: {
        id: string;
        tags: string[];
      };
    }
  | { ok: false; error: string };

// Updates a task's tag list (F041: AS-065, AS-066). Pattern mirrors
// editTask/assignTask above: Zod-validated input (array of non-empty
// trimmed strings), membership re-checked server-side (defense in depth,
// AS-143), admin client used for the actual update, discriminated union
// return, generic user-facing errors with details only logged server-side
// (AS-146).
//
// AS-065: `tags` is a plain string array — zero, one, or many tags, all
// optional in the sense that an empty array is a fully valid task state.
// AS-066: passing `[]` here writes an empty array to the `tags` column
// (which is `not null default '{}'`, per
// supabase/migrations/20260818013434_create_tasks.sql) — never `null`.
// There is no "omit tags to leave unchanged" branch the way editTask has
// for its optional fields; `tags` is always a required array argument, so
// every call is an explicit, full replacement of the tag list.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const updateTaskTagsImpl = withAuthz(
  updateTaskTagsSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to update this task's tags.",
    writeError: "Viewers don't have permission to update tags.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to update tags.",
    // A soft-deleted task behaves as "not found", same convention as
    // assignTask/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<UpdateTaskTagsResult> => {
    // AS-066: `input.tags` may legitimately be `[]` here — that is written
    // as-is, never coerced to null.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ tags: input.tags })
      .eq("id", input.taskId)
      .select("id, tags")
      .single();

    if (updateError || !updated) {
      logger.error("updateTaskTags: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("updateTaskTags: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        tags: updated.tags ?? [],
      },
    };
  },
);

export async function updateTaskTags(
  taskId: string,
  tags: string[],
): Promise<UpdateTaskTagsResult> {
  return updateTaskTagsImpl({ taskId, tags });
}

