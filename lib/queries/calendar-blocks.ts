// Planner-style calendar blocks: freeform, generically-named time blocks a
// member drags onto the calendar (see calendar_blocks migration for the
// full data-model rationale). This is the read path -- every block whose
// [starts_at, ends_at) range overlaps the visible calendar window,
// RLS-scoped exactly like getCalendarTasks (lib/queries/calendar.ts): the
// plain session client only, never createAdminClient(), since
// `calendar_blocks_select_visible`'s own is_project_visible_to/
// is_active_workspace_member predicates are the real enforcement boundary.
//
// Range overlap (not containment): a block that starts before the window
// and ends inside it (or spans the whole window) must still appear, so the
// filter is `starts_at < rangeEndExclusive AND ends_at > rangeStart`
// rather than "both timestamps inside the window".

import { createClient } from "@/lib/supabase/server";

/** "client_presentation" drives both the block's own alarming-red chip
 * default (lib/calendar/block-colors.ts) and the workspace-wide advance
 * notice banner (lib/calendar/client-presentation.ts). See
 * supabase/migrations/20261112010000_calendar_block_client_presentation.sql. */
export type CalendarBlockType = "general" | "client_presentation";

export type CalendarBlock = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  taskId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  color: string | null;
  blockType: CalendarBlockType;
};

type CalendarBlockRow = {
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
};

function toCalendarBlock(row: CalendarBlockRow): CalendarBlock {
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

/**
 * Every calendar block visible to the caller in `workspaceId` whose time
 * range overlaps [rangeStartIso, rangeEndIsoExclusive). Both bounds are
 * full ISO timestamps (not DateOnly strings) -- blocks carry a real time
 * of day, unlike the task due-date grid this feature sits alongside.
 */
export async function getCalendarBlocks(
  workspaceId: string,
  rangeStartIso: string,
  rangeEndIsoExclusive: string,
): Promise<CalendarBlock[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("calendar_blocks")
    .select(
      "id, workspace_id, project_id, user_id, task_id, title, starts_at, ends_at, color, block_type",
    )
    .eq("workspace_id", workspaceId)
    .lt("starts_at", rangeEndIsoExclusive)
    .gt("ends_at", rangeStartIso)
    .order("starts_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(toCalendarBlock);
}
