"use server";
import { logger } from "@/lib/observability/logger";


// F5 (docs/advanced-chat-plan.md): markChannelRead Server Action --
// updates the caller's own `channel_members.last_read_at` to now(), the
// read-cursor F5's unread-count query (lib/queries/chat.ts's
// getWorkspaceChannels) compares each message's `created_at` against.
// Called on-mount of a channel (components/chat/channel-view.tsx) and,
// debounced, on every new message received while that channel stays open.
//
// RLS's `channel_members_update_own` policy (user_id = auth.uid()) is the
// real enforcement boundary -- a caller can only ever bump their own
// membership row, so this action needs no separate ownership re-check the
// way lib/actions/chat-messages.ts's edit/delete actions do for messages.
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/current-user";
import type { ActionOutcome } from "@/lib/actions/authz";

const markChannelReadSchema = z.object({
  channelId: z.string().uuid("Invalid channel."),
});

export type MarkChannelReadResult = ActionOutcome;

export async function markChannelRead(
  channelId: string,
): Promise<MarkChannelReadResult> {
  const parsed = markChannelReadSchema.safeParse({ channelId });

  if (!parsed.success) {
    return { ok: false, error: "Invalid channel." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("channel_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", user.id);

  if (error) {
    // Not a member (RLS/no matching row) or a transient failure --
    // either way this is a best-effort read-cursor bump, so a generic
    // error is returned rather than surfacing raw DB details; callers
    // (ChannelView) don't block the UI on this failing.
    logger.error("markChannelRead: update failed", { error: error });
    return {
      ok: false,
      error: "Something went wrong marking this channel as read.",
    };
  }

  return { ok: true };
}
