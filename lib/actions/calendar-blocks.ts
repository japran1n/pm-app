"use server";

// Planner-style calendar blocks: create/update/delete Server Actions
// (see supabase/migrations/20261107010000_calendar_blocks.sql for the
// data model and RLS this file's checks intentionally re-verify, mirroring
// lib/actions/views.ts's own "session client performs the real write, the
// checks above turn a bare RLS rejection into a specific, friendly
// message" convention). A block is a freeform time range, not a task
// entity -- `taskId` is always optional, never required by any check
// here.
//
// Owner-only mutation, no admin exception (unlike saved_views' AS-430
// "creator OR admin for shared views" case) -- this feature's clarified
// spec has no equivalent "someone else can manage my block" requirement,
// so `calendar_blocks_update_own`/`_delete_own`'s RLS floor (owner_id =
// auth.uid()) is the only enforcement this file adds friendly errors on
// top of; there is no second, wider path.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import {
  createCalendarBlockSchema,
  updateCalendarBlockSchema,
  deleteCalendarBlockSchema,
} from "@/lib/validation/calendar-blocks";
import { logger } from "@/lib/observability/logger";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NOT_FOUND_ERROR = "Block not found.";
const PERMISSION_DENIED_ERROR = "You don't have permission to manage this block.";

export type CalendarBlockActionResult =
  | { ok: true; data: CalendarBlock }
  | { ok: false; error: string };

function toBlock(row: {
  id: string;
  workspace_id: string;
  project_id: string | null;
  user_id: string;
  task_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  color: string | null;
  block_type?: string | null;
}): CalendarBlock {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    userId: row.user_id,
    taskId: row.task_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    color: row.color,
    blockType: row.block_type === "client_presentation" ? "client_presentation" : "general",
  };
}

const SELECT_COLUMNS =
  "id, workspace_id, project_id, user_id, task_id, title, starts_at, ends_at, color, block_type";

type LoadedProject = { id: string; workspaceId: string; visibility: "workspace" | "private" };

async function loadProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<LoadedProject | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    visibility: data.visibility === "private" ? "private" : "workspace",
  };
}

type LoadedBlock = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
};

async function loadBlockForAuthz(
  admin: ReturnType<typeof createAdminClient>,
  blockId: string,
): Promise<LoadedBlock | null> {
  const { data, error } = await admin
    .from("calendar_blocks")
    .select("id, workspace_id, project_id, user_id")
    .eq("id", blockId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    projectId: data.project_id,
    userId: data.user_id,
  };
}

async function revalidateCalendarRoutes(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
) {
  try {
    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceRow?.slug) {
      revalidatePath(`/w/${workspaceRow.slug}/calendar`);
    }
  } catch (revalidateError) {
    logger.error("calendar-blocks: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// Create a new time block -- the drag-to-create/quick-add path.
export async function createCalendarBlock(
  input: unknown,
): Promise<CalendarBlockActionResult> {
  const parsed = createCalendarBlockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid block." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to add a calendar block." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, parsed.data.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const projectId = parsed.data.projectId ?? null;
  if (projectId) {
    const project = await loadProject(admin, projectId);
    if (!project) {
      return { ok: false, error: "Project not found." };
    }
    if (project.workspaceId !== parsed.data.workspaceId) {
      return {
        ok: false,
        error: "This block's workspace does not match the project it belongs to.",
      };
    }
    const visible = await isProjectVisibleToCaller(
      admin,
      { projectId: project.id, visibility: project.visibility },
      user.id,
      membership.role,
    );
    if (!visible) {
      return { ok: false, error: PERMISSION_DENIED_ERROR };
    }
  }

  // The session-scoped client performs the real write --
  // `calendar_blocks_insert_visible` already enforces `user_id =
  // auth.uid()` plus the same visibility rule re-checked above; the
  // checks above just turn a bare RLS rejection into a specific message.
  const { data: inserted, error: insertError } = await supabase
    .from("calendar_blocks")
    .insert({
      workspace_id: parsed.data.workspaceId,
      project_id: projectId,
      user_id: user.id,
      task_id: parsed.data.taskId ?? null,
      title: parsed.data.title,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      color: parsed.data.color ?? null,
      block_type: parsed.data.blockType ?? "general",
    })
    .select(SELECT_COLUMNS)
    .single();

  if (insertError || !inserted) {
    logger.error("createCalendarBlock: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateCalendarRoutes(admin, parsed.data.workspaceId);

  return { ok: true, data: toBlock(inserted) };
}

// Update a block -- covers rename, move (new starts_at/ends_at with the
// same duration), and resize (starts_at/ends_at changed independently).
// The caller decides which of these it is; this action just persists
// whatever combination of fields is sent.
export async function updateCalendarBlock(
  input: unknown,
): Promise<CalendarBlockActionResult> {
  const parsed = updateCalendarBlockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid block." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage calendar blocks." };
  }

  const admin = createAdminClient();
  const block = await loadBlockForAuthz(admin, parsed.data.blockId);
  if (!block) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  if (block.userId !== user.id) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const membership = await requireActiveMembership(admin, block.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // A CHECK constraint (`calendar_blocks_time_order`) rejects an end <=
  // start at the DB layer, but only startsAt or only endsAt may be sent
  // by a resize -- re-validate the effective pair here so a bad partial
  // update returns a friendly error instead of a raw DB constraint
  // failure.
  const { data: current, error: currentError } = await admin
    .from("calendar_blocks")
    .select("starts_at, ends_at")
    .eq("id", block.id)
    .maybeSingle();
  if (currentError || !current) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const effectiveStart = parsed.data.startsAt ?? current.starts_at;
  const effectiveEnd = parsed.data.endsAt ?? current.ends_at;
  if (Date.parse(effectiveEnd) <= Date.parse(effectiveStart)) {
    return { ok: false, error: "End time must be after the start time." };
  }

  const patch: {
    title?: string;
    starts_at?: string;
    ends_at?: string;
    task_id?: string | null;
    color?: string | null;
    block_type?: string;
  } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.startsAt !== undefined) patch.starts_at = parsed.data.startsAt;
  if (parsed.data.endsAt !== undefined) patch.ends_at = parsed.data.endsAt;
  if (parsed.data.taskId !== undefined) patch.task_id = parsed.data.taskId;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.blockType !== undefined) patch.block_type = parsed.data.blockType;

  const { data: updated, error: updateError } = await supabase
    .from("calendar_blocks")
    .update(patch)
    .eq("id", block.id)
    .select(SELECT_COLUMNS)
    .single();

  if (updateError || !updated) {
    logger.error("updateCalendarBlock: update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateCalendarRoutes(admin, block.workspaceId);

  return { ok: true, data: toBlock(updated) };
}

export type DeleteCalendarBlockResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

export async function deleteCalendarBlock(input: unknown): Promise<DeleteCalendarBlockResult> {
  const parsed = deleteCalendarBlockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid block." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage calendar blocks." };
  }

  const admin = createAdminClient();
  const block = await loadBlockForAuthz(admin, parsed.data.blockId);
  if (!block) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  if (block.userId !== user.id) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const { error: deleteError } = await supabase
    .from("calendar_blocks")
    .delete()
    .eq("id", block.id);

  if (deleteError) {
    logger.error("deleteCalendarBlock: delete failed", { error: deleteError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateCalendarRoutes(admin, block.workspaceId);

  return { ok: true, data: { id: block.id } };
}
