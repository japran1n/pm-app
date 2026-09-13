"use server";
import { logger } from "@/lib/observability/logger";


// F8 (docs/advanced-chat-plan.md): toggle an emoji reaction on a chat
// message. Literal copy-paste of lib/actions/comment-reactions.ts's
// toggleReaction, per the plan's F8 instruction, with two adjustments:
//
// - `comment_id` -> `message_id`, `comment_reactions` -> `message_reactions`.
// - Access control mirrors lib/actions/chat-messages.ts's sendMessage, not
//   comment-reactions.ts's canWrite gate: chat access is scoped by
//   `channel_members` (a separate table from workspace roles, per
//   chat-messages.ts's own doc comment), not a workspace-role
//   read/write split -- there is no "viewer" concept in chat, so the only
//   gate is "is the caller a member of this message's channel", matching
//   messages_insert_channel_members / message_reactions_insert_self RLS
//   exactly (see supabase/migrations/20260904020000_chat_system.sql,
//   supabase/migrations/20260904070000_message_reactions_channel_id.sql).
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { toggleMessageReactionSchema } from "@/lib/validation/chat";

// Postgres unique-violation error code, used below to detect the "row
// already exists" branch of the toggle without a separate read -- same
// idempotent-toggle shape as toggleReaction in
// lib/actions/comment-reactions.ts.
const POSTGRES_UNIQUE_VIOLATION = "23505";

export type ToggleMessageReactionResult =
  | {
      ok: true;
      data: { messageId: string; emoji: string; reacted: boolean };
    }
  | { ok: false; error: string };

// Resolves the message's channel + workspace, and re-verifies the caller
// is a member of that channel -- the same predicate
// message_reactions_insert_self / messages_insert_channel_members enforce
// at the RLS layer, re-checked here as defense in depth (AS-143
// convention), mirroring requireChannelMembership in
// lib/actions/chat-messages.ts but additionally returning the workspace
// slug needed for revalidatePath.
async function resolveMessageAndMembership(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  userId: string,
): Promise<
  | { ok: true; channelId: string; workspaceSlug: string | null }
  | { ok: false; error: string }
> {
  const { data: messageRow, error: messageError } = await admin
    .from("messages")
    .select("id, deleted_at, channel_id, channels(workspace_id, workspaces(slug))")
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (messageError || !messageRow) {
    return { ok: false, error: "Message not found." };
  }

  const channelId = messageRow.channel_id;

  const { data: memberRow, error: memberError } = await admin
    .from("channel_members")
    .select("channel_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError || !memberRow) {
    return {
      ok: false,
      error: "You don't have permission to react to this message.",
    };
  }

  const channels = messageRow.channels as
    | { workspace_id: string; workspaces: { slug: string } | { slug: string }[] | null }
    | { workspace_id: string; workspaces: { slug: string } | { slug: string }[] | null }[]
    | null;
  const channelRow = Array.isArray(channels) ? channels[0] : channels;
  const workspaces = channelRow?.workspaces;
  const workspaceSlug = Array.isArray(workspaces) ? workspaces[0]?.slug : workspaces?.slug;

  return { ok: true, channelId, workspaceSlug: workspaceSlug ?? null };
}

// Toggles the caller's own reaction of `emoji` on `messageId`. Same
// insert-first/unique-violation-means-delete convergence toggleReaction
// documents at length in lib/actions/comment-reactions.ts -- see that
// file for the full race-safety rationale, unchanged here.
export async function toggleMessageReaction(
  messageId: string,
  emoji: string,
): Promise<ToggleMessageReactionResult> {
  const parsed = toggleMessageReactionSchema.safeParse({ messageId, emoji });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reaction.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to react to a message." };
  }

  const admin = createAdminClient();
  const check = await resolveMessageAndMembership(
    admin,
    parsed.data.messageId,
    user.id,
  );

  if (!check.ok) {
    return check;
  }

  const row = {
    message_id: parsed.data.messageId,
    user_id: user.id,
    emoji: parsed.data.emoji,
    // Denormalized from the message's own channel_id (F8's migration,
    // mirroring comment_reactions.task_id/F305) so the reactions realtime
    // subscription can filter server-side on `channel_id=eq.<channelId>`.
    // RLS's message_reactions_insert_self independently re-verifies this
    // matches the message's real channel_id.
    channel_id: check.channelId,
  };

  const { error: insertError } = await supabase
    .from("message_reactions")
    .insert(row);

  let reacted: boolean;

  if (!insertError) {
    reacted = true;
  } else if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
    const { error: deleteError } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", row.message_id)
      .eq("user_id", row.user_id)
      .eq("emoji", row.emoji);

    if (deleteError) {
      logger.error("toggleMessageReaction: delete-after-conflict failed", { error: deleteError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    reacted = false;
  } else {
    logger.error("toggleMessageReaction: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (check.workspaceSlug) {
    try {
      revalidatePath(`/w/${check.workspaceSlug}/chat/${check.channelId}`);
    } catch (revalidateError) {
      // Non-fatal cache-freshness rationale, same as toggleReaction /
      // sendMessage.
      logger.error("toggleMessageReaction: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      messageId: parsed.data.messageId,
      emoji: parsed.data.emoji,
      reacted,
    },
  };
}
