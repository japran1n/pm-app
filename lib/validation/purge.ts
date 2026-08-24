import { z } from "zod";

// Validates purgeTrashItem input (F192: AS-348, AS-349). `itemType`
// distinguishes a task purge from a comment purge — the two hard-delete
// through different RPCs (purge_task / purge_comment,
// supabase/migrations/20260822220000_purge_task_and_comment.sql) with
// different dependent-row cleanup, per this feature's own worker brief
// ("permanently removes a trashed task (or comment)").
//
// `confirmation` is the typed-confirmation text (Clarified implementation's
// ambiguity-resolution answer: the simpler option, no new dependency — a
// literal typed "DELETE" the caller must reproduce exactly, checked against
// PURGE_CONFIRMATION_PHRASE below in lib/actions/purge.ts, rather than a
// per-item-count phrase that would require the client to pass an
// independently-verifiable count).
export const PURGE_CONFIRMATION_PHRASE = "DELETE";

export const purgeTrashItemSchema = z.object({
  itemId: z.string().uuid("Invalid item."),
  itemType: z.enum(["task", "comment"]),
  confirmation: z.string(),
});

export type PurgeTrashItemInput = z.infer<typeof purgeTrashItemSchema>;
