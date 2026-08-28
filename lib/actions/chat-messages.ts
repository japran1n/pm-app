"use server";

// F3 (docs/advanced-chat-plan.md): Server Actions for sending/editing/
// soft-deleting a chat message. Pattern mirrors lib/actions/comments.ts /
// lib/actions/comment-reactions.ts: Zod-validated input, membership
// re-checked server-side (defense in depth -- RLS is the real enforcement
// boundary, see supabase/migrations/20260904020000_chat_system.sql's
// messages_insert_channel_members / messages_update_sender_only policies),
// discriminated-union return, generic user-facing errors with details only
// logged server-side.
//
// Unlike lib/actions/comments.ts's addComment, channel membership is NOT
// workspace-role-gated the same way -- requireActiveMembership (lib/auth/
// require-membership.ts) checks `workspace_members`, but chat access is
// scoped by `channel_members`, a separate table (a workspace member is not
// automatically a channel member; F2's auto-enroll only covers the
// workspace-wide "general" channel). So this file re-checks membership
// directly against `channel_members`, matching the RLS predicate exactly
// rather than reusing the workspace-level helper.
import { revalidatePath } from "next/cache";
import type { JSONContent } from "@tiptap/react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getThreadMessages } from "@/lib/queries/chat";
import {
  deleteMessageSchema,
  editMessageSchema,
  sendMessageSchema,
} from "@/lib/validation/chat";
// F339/F340 regression (see docs/advanced-chat-plan.md's F3 section):
// apply the same `toPlainJson()` round-trip to a client-supplied Tiptap
// JSON body BEFORE it crosses the Server Action boundary from a rich-text
// composer, so if/when F13 upgrades the chat composer off plain
// <textarea>, this action doesn't reopen the exact "temporary client
// reference" 500 that hit comments/descriptions.
// F12 (docs/advanced-chat-plan.md): populate the plain-text projection
// column (messages.body_text, indexed by
// supabase/migrations/20260904030000_messages_search.sql) at the same
// call sites that already own the Tiptap JSONContent body, rather than a
// SQL-side generated column -- see that migration's doc comment.
import { toPlainJson, extractPlainText } from "@/lib/comments/rich-text";
// F13 (docs/advanced-chat-plan.md): reuses the exact same mention-id
// extraction the description/comment mention pipeline already uses
// (lib/notifications/mentions.ts's `extractMentionIds`) rather than a
// second tree-walk implementation of the same five-line rule -- "ceo
// mention lanac je gotov ... primeniti isti fix od početka" per this
// feature's spec.
import { extractMentionIds } from "@/lib/notifications/mentions";
import { createNotification } from "@/lib/notifications/create-notification";

// F11 (docs/advanced-chat-plan.md): a file/image attached to a message.
// `signedUrl` is minted fresh at read time (never persisted/reused across
// requests) -- same convention as every other attachment surface in this
// codebase (lib/actions/attachments.ts's getAttachmentSignedUrl).
export type ChatMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  signedUrl: string | null;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  senderId: string;
  bodyJson: JSONContent;
  parentMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments?: ChatMessageAttachment[];
};

export type SendMessageResult =
  | { ok: true; data: ChatMessage }
  | { ok: false; error: string };

export type EditMessageResult =
  | { ok: true; data: { id: string; bodyJson: JSONContent; editedAt: string } }
  | { ok: false; error: string };

export type DeleteMessageResult =
  | { ok: true; data: { id: string; deletedAt: string } }
  | { ok: false; error: string };

function toChatMessage(row: {
  id: string;
  channel_id: string;
  sender_id: string;
  body_json: unknown;
  parent_message_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    bodyJson: row.body_json as JSONContent,
    parentMessageId: row.parent_message_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

// Re-checks the caller has an active `channel_members` row for `channelId`
// -- the same predicate messages_insert_channel_members / messages_select_
// channel_members enforce at the RLS layer, re-verified here as defense in
// depth per this repo's AS-143 convention.
async function requireChannelMembership(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("channel_members")
    .select("channel_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();

  return !error && !!data;
}

// Looks up the channel's workspace slug, for revalidatePath after a
// mutation (mirrors toggleReaction's non-fatal revalidate pattern in
// lib/actions/comment-reactions.ts).
async function revalidateChannelPath(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
) {
  try {
    const { data: channelRow } = await admin
      .from("channels")
      .select("workspace_id, workspaces(slug)")
      .eq("id", channelId)
      .maybeSingle();

    const workspaces = channelRow?.workspaces as
      | { slug: string }
      | { slug: string }[]
      | null
      | undefined;
    const slug = Array.isArray(workspaces) ? workspaces[0]?.slug : workspaces?.slug;

    if (slug) {
      revalidatePath(`/w/${slug}/chat/${channelId}`);
    }
  } catch (revalidateError) {
    // Non-fatal cache-freshness rationale, same as addComment /
    // toggleReaction: realtime (F3's use-chat-messages-realtime hook) is
    // the primary mechanism for a sender's own open tab and every other
    // open client to see the new/edited/deleted message; revalidatePath is
    // only a defense-in-depth freshness nudge for a fresh navigation.
    console.error(
      "chat-messages: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }
}

// F13 (docs/advanced-chat-plan.md): notifies every mentioned user who is
// (a) an actual member of this channel -- the same visibility boundary
// lib/comments/mentions.ts's resolveVisibleMentionIds enforces for task
// comments, generalised here to "is this id currently in channel_members"
// since chat access is scoped by channel membership, not project
// visibility -- and (b) not the sender themselves (never notify yourself
// for your own mention, matching AS-384's "except the author" rule this
// codebase already applies everywhere else notifications fan out).
// Non-fatal by design, mirroring every other post-write notification side
// effect in this codebase (see e.g. notifyNewlyMentionedUsers): a
// notification failure must never fail the message send itself.
async function notifyMentionedChannelMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>,
  params: {
    channelId: string;
    messageId: string;
    senderId: string;
    bodyJson: JSONContent;
  },
): Promise<void> {
  const mentionedIds = Array.from(extractMentionIds(params.bodyJson)).filter(
    (id) => id !== params.senderId,
  );
  if (mentionedIds.length === 0) return;

  try {
    const { data: channelRow, error: channelError } = await admin
      .from("channels")
      .select("workspace_id")
      .eq("id", params.channelId)
      .maybeSingle();

    if (channelError || !channelRow) {
      console.error(
        "sendMessage: mention notify - channel lookup failed (non-fatal):",
        channelError,
      );
      return;
    }

    // Only ids that are ACTUAL current channel members are notified -- a
    // hand-crafted bodyJson referencing someone with no access to this
    // channel is silently skipped for notification purposes (the message
    // itself already posted; this only gates who gets pinged), same
    // "re-derive the real access predicate server-side, never trust the
    // client's mention list" rule lib/comments/mentions.ts documents for
    // the task/comment path.
    const { data: memberRows, error: memberError } = await admin
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", params.channelId)
      .in("user_id", mentionedIds);

    if (memberError) {
      console.error(
        "sendMessage: mention notify - member lookup failed (non-fatal):",
        memberError,
      );
      return;
    }

    const visibleRecipientIds = (memberRows ?? []).map((row) => row.user_id as string);

    for (const recipientId of visibleRecipientIds) {
      await createNotification(
        supabase,
        {
          userId: recipientId,
          workspaceId: channelRow.workspace_id as string,
          kind: "mention",
          // F13: no task_id for a chat mention -- channelId/messageId are
          // carried in payload instead (see create-notification.ts's doc
          // comment on why comment_id can't be reused for a message id).
          payload: { channelId: params.channelId, messageId: params.messageId },
        },
        "sendMessage",
      );
    }
  } catch (notifyError) {
    console.error(
      "sendMessage: mention notification failed (non-fatal):",
      notifyError,
    );
  }
}

const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

// F11: links a set of already-uploaded, still-pending attachments (see
// lib/attachments/upload-chat.ts -- uploaded eagerly by the composer,
// before the message exists) to a newly-sent message, then returns them
// with fresh signed URLs for the immediate optimistic-append. Only rows
// that are (a) uploaded by this exact sender, (b) scoped to this exact
// channel, and (c) still unlinked (message_id is null) are eligible --
// this is the same predicate the F11 migration's
// message_attachments_update_link_own_pending RLS policy enforces, so a
// caller can never link someone else's pending upload (or one from a
// different channel) onto their own message.
async function linkAndLoadAttachments(
  admin: ReturnType<typeof createAdminClient>,
  attachmentIds: string[],
  messageId: string,
  channelId: string,
  senderId: string,
): Promise<ChatMessageAttachment[]> {
  if (attachmentIds.length === 0) return [];

  const { data: linked, error: linkError } = await admin
    .from("message_attachments")
    .update({ message_id: messageId })
    .in("id", attachmentIds)
    .eq("channel_id", channelId)
    .eq("uploaded_by", senderId)
    .is("message_id", null)
    .select("id, storage_path, file_name, mime_type, file_size");

  if (linkError || !linked) {
    console.error("sendMessage: linking attachments failed:", linkError);
    return [];
  }

  const attachments: ChatMessageAttachment[] = [];
  for (const row of linked) {
    const { data: signedUrlData, error: signedUrlError } = await admin.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrl(row.storage_path, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);

    if (signedUrlError) {
      console.error(
        "sendMessage: signed URL generation failed for attachment:",
        signedUrlError,
      );
    }

    attachments.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      signedUrl: signedUrlData?.signedUrl ?? null,
    });
  }

  return attachments;
}

// F10 (docs/advanced-chat-plan.md): thin Server Action wrapper so the
// client-side ThreadPanel can call the server-only getThreadMessages
// query -- lib/queries/chat.ts is `import "server-only"`, so a Client
// Component can't import it directly, same "wrap the query in an action"
// convention this file already follows for reads that need a client entry
// point.
export async function getThreadMessagesAction(
  parentMessageId: string,
): Promise<ChatMessage[]> {
  const messages = await getThreadMessages(parentMessageId);
  return messages;
}

// Sends a message to a channel the caller has joined (F3's core action).
// The plan's acceptance criteria (AS-014-equivalent for chat) requires this
// to fail for a non-member -- RLS's messages_insert_channel_members policy
// is the real enforcement boundary; requireChannelMembership below is the
// same defense-in-depth re-check every other Server Action in this repo
// performs.
export async function sendMessage(
  channelId: string,
  bodyJson: JSONContent,
  parentMessageId?: string | null,
  // F11: ids of attachments the composer already uploaded (pending,
  // unlinked) before the user hit send -- linked to the resulting message
  // row below. Optional so every existing caller (F3/F10) keeps working
  // unchanged.
  attachmentIds?: string[],
): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse({
    channelId,
    bodyJson,
    parentMessageId: parentMessageId ?? undefined,
  });

  if (!parsed.success) {
    console.error(
      "[sendMessage] Zod validation failed. channelId received:",
      JSON.stringify(channelId),
      "type:", typeof channelId,
      "issues:", JSON.stringify(parsed.error.issues),
    );
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid message.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to send a message." };
  }

  const admin = createAdminClient();
  const isMember = await requireChannelMembership(
    admin,
    parsed.data.channelId,
    user.id,
  );

  if (!isMember) {
    return {
      ok: false,
      error: "You don't have permission to post in this channel.",
    };
  }

  // Insert through the caller's own authenticated session (not the admin
  // client) so RLS's messages_insert_channel_members / sender_id = auth.uid()
  // policy is the real enforcement boundary, mirroring watchTask/
  // toggleReaction's "self-serve via own session" convention.
  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      channel_id: parsed.data.channelId,
      sender_id: user.id,
      body_json: toPlainJson(parsed.data.bodyJson as JSONContent),
      body_text: extractPlainText(parsed.data.bodyJson as JSONContent),
      parent_message_id: parsed.data.parentMessageId ?? null,
    })
    .select(
      "id, channel_id, sender_id, body_json, parent_message_id, edited_at, deleted_at, created_at",
    )
    .single();

  if (insertError || !inserted) {
    console.error("sendMessage: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong sending your message. Please try again.",
    };
  }

  const attachments = await linkAndLoadAttachments(
    admin,
    attachmentIds ?? [],
    inserted.id,
    parsed.data.channelId,
    user.id,
  );

  // F13: fire-and-forget style (awaited, but errors inside are already
  // caught and logged non-fatally) -- a mention notification failure must
  // never fail the message send itself, same convention as every other
  // post-write notification side effect in this codebase.
  await notifyMentionedChannelMembers(supabase, admin, {
    channelId: parsed.data.channelId,
    messageId: inserted.id,
    senderId: user.id,
    bodyJson: parsed.data.bodyJson as JSONContent,
  });

  await revalidateChannelPath(admin, parsed.data.channelId);

  return {
    ok: true,
    data: { ...toChatMessage(inserted), attachments },
  };
}

// Edits the caller's own message (F9 UI consumes this; ships now per the
// plan's F3 scope so F9 is UI-only). Server-side re-check of ownership --
// RLS's messages_update_sender_only is the real boundary, this is
// defense-in-depth (AS-143 convention) so a direct Server Action call
// against someone else's message returns a generic error rather than
// silently no-op'ing via RLS with a confusing 0-rows-updated result.
export async function editMessage(
  messageId: string,
  bodyJson: JSONContent,
): Promise<EditMessageResult> {
  const parsed = editMessageSchema.safeParse({ messageId, bodyJson });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid message.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a message." };
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("messages")
    .select("id, sender_id, channel_id, deleted_at")
    .eq("id", parsed.data.messageId)
    .maybeSingle();

  if (existingError || !existing || existing.deleted_at) {
    return { ok: false, error: "Message not found." };
  }

  if (existing.sender_id !== user.id) {
    return {
      ok: false,
      error: "You can only edit your own messages.",
    };
  }

  const editedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("messages")
    .update({
      body_json: toPlainJson(parsed.data.bodyJson as JSONContent),
      body_text: extractPlainText(parsed.data.bodyJson as JSONContent),
      edited_at: editedAt,
    })
    .eq("id", parsed.data.messageId)
    .select("id, body_json, edited_at")
    .single();

  if (updateError || !updated) {
    console.error("editMessage: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong editing your message. Please try again.",
    };
  }

  await revalidateChannelPath(admin, existing.channel_id);

  return {
    ok: true,
    data: {
      id: updated.id,
      bodyJson: updated.body_json as JSONContent,
      editedAt: updated.edited_at as string,
    },
  };
}

// Soft-deletes the caller's own message (sets deleted_at; the row stays in
// place so every open client renders a "Message deleted" placeholder
// instead of the message vanishing out of the DOM -- F3's acceptance
// criteria).
export async function deleteMessage(
  messageId: string,
): Promise<DeleteMessageResult> {
  const parsed = deleteMessageSchema.safeParse({ messageId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid message.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a message." };
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("messages")
    .select("id, sender_id, channel_id, deleted_at")
    .eq("id", parsed.data.messageId)
    .maybeSingle();

  if (existingError || !existing || existing.deleted_at) {
    return { ok: false, error: "Message not found." };
  }

  if (existing.sender_id !== user.id) {
    return {
      ok: false,
      error: "You can only delete your own messages.",
    };
  }

  const deletedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("messages")
    // F12: clear the search projection too, so a soft-deleted message
    // (which still renders a "Message deleted" placeholder to open
    // clients per this function's own doc comment) no longer surfaces in
    // search results.
    .update({ deleted_at: deletedAt, body_text: "" })
    .eq("id", parsed.data.messageId)
    .select("id, deleted_at")
    .single();

  if (updateError || !updated) {
    console.error("deleteMessage: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong deleting your message. Please try again.",
    };
  }

  await revalidateChannelPath(admin, existing.channel_id);

  return {
    ok: true,
    data: { id: updated.id, deletedAt: updated.deleted_at as string },
  };
}
