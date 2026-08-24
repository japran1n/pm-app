"use server";

// F226 (AS-422, AS-424): read/write the signed-in user's per-project board
// view preferences -- swimlane grouping mode and, per grouping mode, which
// lane keys are collapsed. Pattern mirrors lib/actions/notification-
// preferences.ts's own doc comment: Zod-validated input, the caller's own
// session client (RLS is self-scoped -- see the migration's header
// comment for why no admin client or SECURITY DEFINER RPC is needed for a
// user writing their own row), generic user-facing errors with details
// only logged server-side.
//
// Server Component data-loading half: the board page calls
// getBoardSwimlanePrefs and passes the result down as typed props (this
// feature's Clarified implementation's "server-fetched... passed down as
// typed props" pattern), so the first paint already reflects the
// persisted grouping/collapse state instead of flashing the default and
// then correcting itself client-side.

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const SWIMLANE_GROUP_BY_PREF_VALUES = [
  "none",
  "assignee",
  "priority",
  "tag",
] as const;

export type SwimlaneGroupByPref = (typeof SWIMLANE_GROUP_BY_PREF_VALUES)[number];

export type BoardSwimlanePrefs = {
  groupBy: SwimlaneGroupByPref;
  /** Collapsed lane keys, keyed by grouping mode -- see the migration's
   * header comment for why this is an object-of-arrays rather than a flat
   * array (switching grouping mode must never carry a stale collapse
   * across modes). */
  collapsedLanes: Record<string, string[]>;
};

const DEFAULT_PREFS: BoardSwimlanePrefs = {
  groupBy: "none",
  collapsedLanes: {},
};

export type GetBoardSwimlanePrefsResult =
  | { ok: true; data: BoardSwimlanePrefs }
  | { ok: false; error: string };

// No row for this (user, project) pair (never opened this board before, or
// signed up after the row would otherwise have existed -- this table is
// NOT auto-created per-project the way notification_preferences is
// auto-created per-user, since we don't know every project a user will
// ever open) resolves to DEFAULT_PREFS -- the exact pre-F226 behaviour, so
// an unmigrated viewer's board renders identically to today.
export async function getBoardSwimlanePrefs(
  projectId: string,
): Promise<GetBoardSwimlanePrefsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("board_swimlane_prefs")
    .select("group_by, collapsed_lanes")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error("getBoardSwimlanePrefs: read failed:", error);
    return { ok: false, error: "Could not load your board preferences." };
  }

  if (!data) {
    return { ok: true, data: DEFAULT_PREFS };
  }

  const groupBy = SWIMLANE_GROUP_BY_PREF_VALUES.includes(
    data.group_by as SwimlaneGroupByPref,
  )
    ? (data.group_by as SwimlaneGroupByPref)
    : "none";

  const collapsedLanes =
    data.collapsed_lanes && typeof data.collapsed_lanes === "object"
      ? (data.collapsed_lanes as Record<string, string[]>)
      : {};

  return { ok: true, data: { groupBy, collapsedLanes } };
}

const upsertSchema = z.object({
  projectId: z.string().uuid(),
  groupBy: z.enum(SWIMLANE_GROUP_BY_PREF_VALUES).optional(),
  // AS-422: the FULL set of collapsed lane keys for ONE grouping mode --
  // the caller (board.tsx) always sends the whole current set for the
  // mode it's updating, not a single toggled key, so a stale/renamed key
  // can be dropped from the set on write (see the doc comment below) and
  // "collapse" vs "expand" are both just "write the new set", no separate
  // add/remove action needed.
  collapsedLanesForMode: z
    .object({
      mode: z.enum(SWIMLANE_GROUP_BY_PREF_VALUES),
      keys: z.array(z.string().min(1).max(200)).max(500),
    })
    .optional(),
});

export type UpsertBoardSwimlanePrefsInput = z.infer<typeof upsertSchema>;

export type UpsertBoardSwimlanePrefsResult =
  | { ok: true }
  | { ok: false; error: string };

// A single action handles both "grouping mode changed" and "a lane's
// collapse state changed" -- board.tsx calls it (fire-and-forget,
// optimistic client state already updated) from two different call sites
// with different fields set, per this feature's Clarified implementation's
// "existing Server Actions... optimistic UI" pattern. At least one of
// `groupBy` / `collapsedLanesForMode` must be present.
export async function upsertBoardSwimlanePrefs(
  input: UpsertBoardSwimlanePrefsInput,
): Promise<UpsertBoardSwimlanePrefsResult> {
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid board preference update." };
  }
  const { projectId, groupBy, collapsedLanesForMode } = parsed.data;
  if (!groupBy && !collapsedLanesForMode) {
    return { ok: false, error: "Nothing to update." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // Read the existing row first (self-scoped by RLS -- see this file's
  // own header comment on why no admin client is needed here) so a
  // collapse-only write doesn't clobber a previously-chosen groupBy, and
  // a groupBy-only write doesn't clobber previously-collapsed lanes in
  // OTHER modes.
  const { data: existing, error: readError } = await supabase
    .from("board_swimlane_prefs")
    .select("group_by, collapsed_lanes")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (readError) {
    console.error("upsertBoardSwimlanePrefs: read failed:", readError);
    return { ok: false, error: "Could not save your board preferences." };
  }

  const currentCollapsed: Record<string, string[]> =
    existing?.collapsed_lanes && typeof existing.collapsed_lanes === "object"
      ? (existing.collapsed_lanes as Record<string, string[]>)
      : {};

  const nextCollapsed = collapsedLanesForMode
    ? {
        ...currentCollapsed,
        // Writing this mode's FULL set (not merging) is what naturally
        // prunes a stale key: the caller only ever sends keys for lanes
        // that exist RIGHT NOW (board.tsx derives the set from the
        // rendered swimlaneGroups), so a renamed tag or removed
        // assignee's old key is simply absent from the next write and
        // silently disappears from storage -- no separate cleanup pass
        // needed. An empty array is stored explicitly (not deleted),
        // which correctly means "this mode has zero collapsed lanes"
        // rather than "no preference recorded for this mode".
        [collapsedLanesForMode.mode]: collapsedLanesForMode.keys,
      }
    : currentCollapsed;

  const nextGroupBy = groupBy ?? existing?.group_by ?? "none";

  const { error: writeError } = await supabase
    .from("board_swimlane_prefs")
    .upsert(
      {
        user_id: user.id,
        project_id: projectId,
        group_by: nextGroupBy,
        collapsed_lanes: nextCollapsed,
      },
      { onConflict: "user_id,project_id" },
    );

  if (writeError) {
    console.error("upsertBoardSwimlanePrefs: write failed:", writeError);
    return { ok: false, error: "Could not save your board preferences." };
  }

  return { ok: true };
}
