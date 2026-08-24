import { z } from "zod";

// F226 (AS-422, AS-424): shared value/type/schema definitions for board
// swimlane preferences. Split out of lib/actions/board-prefs.ts because a
// "use server" file may only export async functions -- see
// https://nextjs.org/docs/messages/invalid-use-server-value -- so the
// constant array, derived types, and Zod schema below (all non-function
// exports) live here instead, and lib/actions/board-prefs.ts imports them.

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

export type GetBoardSwimlanePrefsResult =
  | { ok: true; data: BoardSwimlanePrefs }
  | { ok: false; error: string };

export const upsertBoardSwimlanePrefsSchema = z.object({
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

export type UpsertBoardSwimlanePrefsInput = z.infer<
  typeof upsertBoardSwimlanePrefsSchema
>;

export type UpsertBoardSwimlanePrefsResult =
  | { ok: true }
  | { ok: false; error: string };
