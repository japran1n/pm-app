"use server";

import { revalidatePath } from "next/cache";
import { toggleDescriptionChecklistItemSchema } from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import type { JSONContent } from "@/components/editor/rich-text-editor";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { canEditTask } from "@/lib/auth/permissions";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";

// F173 (AS-311): recursively finds the `taskItem` node carrying `itemId`
// (its `id` attr, assigned client-side by
// components/editor/rich-text-editor.tsx's `TaskItemWithId`) inside a
// Tiptap JSON document and returns a NEW document with only that node's
// `checked` attr flipped — every other node/array in the tree is reused
// by reference (not cloned) except along the path down to the match, so
// this stays cheap even for a long description. Returns `null` if no node
// with that id exists (already-deleted item, stale client, or a document
// stored before ids existed) so the caller can distinguish "nothing to
// toggle" from "toggled".
function setTaskItemChecked(
  node: JSONContent,
  itemId: string,
  checked: boolean,
): JSONContent | null {
  if (
    node.type === "taskItem" &&
    (node.attrs as { id?: unknown } | undefined)?.id === itemId
  ) {
    return { ...node, attrs: { ...node.attrs, checked } };
  }
  if (!Array.isArray(node.content)) return null;
  for (let i = 0; i < node.content.length; i++) {
    const updatedChild = setTaskItemChecked(node.content[i], itemId, checked);
    if (updatedChild) {
      const content = node.content.slice();
      content[i] = updatedChild;
      return { ...node, content };
    }
  }
  return null;
}

export type ToggleDescriptionChecklistItemResult = ActionResult<{ descriptionJson: JSONContent }>;

// F173 (AS-311): toggles a single checkbox inside a task description's
// rich-text content WITHOUT opening the full editor and without the
// caller round-tripping the entire document through editTask/description
// — this is deliberately its own narrow action, not a call to editTask,
// for two reasons documented in this feature's handoff:
//
//   1. editTask's `updates.description` is the LEGACY plain-text column
//      (AS-054's original contract) — there is no field on
//      `EditTaskUpdates` for description_json at all, and adding one
//      would reopen the "which column is the source of truth" question
//      20260822090000_task_description_json.sql's header comment
//      explicitly deferred to a later feature. This action writes
//      `description_json` ONLY, leaving `description` untouched, which is
//      exactly the shape
//      20260822130000_task_description_json_direct_write.sql's trigger
//      condition (`description_json` changed, `description` did not)
//      detects to keep the direct write instead of overwriting it back
//      from the legacy column.
//   2. Concurrency: re-fetching the CURRENT description_json here (not
//      trusting whatever stale copy the client had open) and writing back
//      a full-document copy with only the target node's `checked` flipped
//      is a deliberate, documented last-write-wins tradeoff — two
//      concurrent toggles of DIFFERENT checkboxes on the same task within
//      the same read-modify-write window can still race (the second
//      write's read predates the first write's commit), overwriting one
//      of the two toggles. This is accepted as the simpler option (no new
//      dependency, no optimistic-concurrency version column, no second
//      source of truth) per this feature's clarified ambiguity-resolution
//      answer — see the handoff's Decisions Made for the full rationale,
//      including why this differs from F153's structured checklist (whose
//      items are separate rows, so concurrent toggles of different items
//      never collide at the row level).
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. Uses `canEditTask` (via
// `writeCheck`), not the default `canWrite` — same narrower gate
// editTask itself uses, since this is a write to the same row.
const toggleDescriptionChecklistItemImpl = withAuthz(
  toggleDescriptionChecklistItemSchema,
  {
    requireWrite: true,
    writeCheck: canEditTask,
    membershipError: "You don't have permission to edit this task.",
    writeError: "Viewers don't have permission to edit tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to edit tasks.",
    // Same task lookup as editTask above — this action is a narrower
    // write to the same row, so it is permission-checked identically
    // (AS-061: any active member, no ownership restriction; viewers/
    // guests cannot edit, mirroring editTask's own gate).
    // `description_json` is threaded through as `extra` so the handler
    // doesn't need a second query.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, description_json, client_visible, projects!inner(id, workspace_id, visibility)",
        )
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
        extra: {
          descriptionJson: taskRow.description_json as JSONContent | null,
          clientVisible: Boolean(taskRow.client_visible),
        },
      };
    },
  },
  async (input, ctx): Promise<ToggleDescriptionChecklistItemResult> => {
    const currentDoc = ctx.descriptionJson ?? {
      type: "doc",
      content: [],
    };

    const updatedDoc = setTaskItemChecked(
      currentDoc,
      input.itemId,
      input.checked,
    );

    if (!updatedDoc) {
      return {
        ok: false,
        error:
          "This checklist item no longer exists. Reload the task to see the latest description.",
      };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      // Only description_json is written — description is deliberately
      // absent from this payload (see this function's doc comment, point 1
      // above).
      .update({ description_json: updatedDoc })
      .eq("id", input.taskId)
      .select("description_json")
      .single();

    if (updateError || !updated) {
      logger.error("toggleDescriptionChecklistItem: update failed", { error: updateError });
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
        console.warn(
          "toggleDescriptionChecklistItem: revalidatePath failed (non-fatal):",
          revalidateError,
        );
      }

      // AS-006 scrutiny remediation: a checklist toggle on a client-visible
      // task's description is visible on the portal task detail, so it must
      // also revalidate the portal. Gated on `client_visible` (loaded above
      // with no extra round trip).
      if (ctx.clientVisible) {
        revalidatePortalProject(workspaceRow.slug, ctx.projectId!);
      }
    }

    return {
      ok: true,
      data: { descriptionJson: updated.description_json as JSONContent },
    };
  },
);

export async function toggleDescriptionChecklistItem(
  taskId: string,
  itemId: string,
  checked: boolean,
): Promise<ToggleDescriptionChecklistItemResult> {
  return toggleDescriptionChecklistItemImpl({ taskId, itemId, checked });
}

