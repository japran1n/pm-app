// Planner-style calendar blocks: freeform, generically-named time blocks a
// member drags onto the calendar (see calendar_blocks migration for the
// full data-model rationale). This is the read path -- every block whose
// [starts_at, ends_at) range overlaps the visible calendar window,
// RLS-scoped the same way other calendar-surface reads are: the
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
 *
 * `userIds`, when provided (F012's `?people=` selection), restricts the
 * result to blocks owned by that set of members -- applied as a
 * database-level `in` restriction on the blocks query itself (AS-029),
 * never by fetching everyone and discarding rows afterwards. Omitting it
 * keeps the whole-workspace behaviour any other caller relies on.
 *
 * F013 (AS-031): before that restriction is applied, `userIds` is first
 * resolved against `workspace_members` and narrowed to only the ids that
 * currently have `status = 'active'` in `workspaceId`. A deactivated (or
 * invited-but-not-yet-active, or removed) member's id is stripped here
 * even when the caller passed it explicitly, so their blocks are never
 * returned regardless of what the caller asked for.
 */
export async function getCalendarBlocks(
  workspaceId: string,
  rangeStartIso: string,
  rangeEndIsoExclusive: string,
  userIds?: readonly string[],
): Promise<CalendarBlock[]> {
  const supabase = await createClient();

  let restrictedUserIds: string[] | undefined;
  if (userIds !== undefined) {
    if (userIds.length === 0) {
      // Explicitly empty selection: no one is selected, so no blocks --
      // without even touching the database.
      return [];
    }

    const { data: activeMembers, error: membersError } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .in("user_id", userIds as string[]);

    if (membersError) {
      throw membersError;
    }

    restrictedUserIds = (activeMembers ?? [])
      .map((row) => (row as { user_id: string | null }).user_id)
      .filter((id): id is string => id !== null);

    if (restrictedUserIds.length === 0) {
      // None of the requested ids are active members of this workspace.
      return [];
    }
  }

  let query = supabase
    .from("calendar_blocks")
    .select(
      "id, workspace_id, project_id, user_id, title, starts_at, ends_at, color, block_type",
    )
    .eq("workspace_id", workspaceId)
    .lt("starts_at", rangeEndIsoExclusive)
    .gt("ends_at", rangeStartIso);

  if (restrictedUserIds !== undefined) {
    query = query.in("user_id", restrictedUserIds);
  }

  const { data, error } = await query.order("starts_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(toCalendarBlock);
}
