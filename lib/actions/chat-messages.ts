"use server";
import { logger } from "@/lib/observability/logger";


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
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getThreadMessages, getChannelMessages, getMessageAttachments } from "@/lib/queries/chat";
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
// F120 (AS-071): bare-URL autolinker -- see that file's doc comment for why
// this needs to run server-side rather than relying solely on Tiptap's own
// client-side autolink plugin.
import { autolinkBody } from "@/lib/chat/autolink-body";
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
//
// Faza A (docs/chat-slack-parity-plan.md, BUG-2): `signedUrl` and
// `fileSize` are optional and `storagePath` was added because this type
// now covers TWO origins that weren't both wired up before -- sendMessage
// below (a fresh signedUrl, no storagePath) and getThreadMessagesAction's
// getMessageAttachments merge (a storagePath, no signedUrl yet --
// ChatAttachment mints one client-side on demand). Same widened shape as
// channel-view.tsx's own ChatMessageAttachment; see that file's doc
// comment for the full origin story.
export type ChatMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize?: number | null;
  signedUrl?: string | null;
  storagePath?: string;
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
    logger.error("chat-messages: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

// F13 (docs/advanced-chat-plan.md) + Faza D (docs/chat-slack-parity-plan.md):
// computes who gets notified for a just-sent message and with which kind,
// then writes each one. Three sources, in priority order (a user who
// qualifies through more than one is notified once, with the more
// specific kind, same dedupe rule lib/notifications/fanout.ts's
// computeFanoutRecipients documents for the task-notification path):
//
//   1. mention -- every @mentioned user who is an ACTUAL current member of
//      this channel (the same visibility boundary lib/comments/
//      mentions.ts's resolveVisibleMentionIds enforces for task comments,
//      generalised to "is this id currently in channel_members" since
//      chat access is scoped by channel membership, not project
//      visibility) and not the sender.
//   2. chat_dm -- if this channel is a DM (kind='dm'), every OTHER member
//      gets notified for ANY message, not just an @mention -- a DM has no
//      "just browsing" case the way a busy workspace channel does.
//   3. chat_thread_reply -- if this message is a threaded reply, every
//      other participant in that thread (the parent's sender plus anyone
//      else who has already replied) gets notified, mirroring
//      `comment_reply`'s "notify watchers of the parent" shape. Mutually
//      exclusive with (2): a DM's own threads still just re-notify via
//      chat_dm, since every DM member is already being notified on every
//      message regardless of thread status.
//
// Deliberately does NOT notify for a plain top-level message in a
// non-DM channel with no mention -- that's the unread badge's job
// (chat-nav-list.tsx), not a notification; a notification for every
// message in a busy workspace channel would be exactly the kind of spam
// this app's existing per-kind preference model is designed to avoid.
//
// Non-fatal by design, mirroring every other post-write notification side
// effect in this codebase (see e.g. notifyNewlyMentionedUsers): a
// notification failure must never fail the message send itself.
async function notifyChatMessageRecipients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>,
  params: {
    channelId: string;
    messageId: string;
    parentMessageId: string | null;
    senderId: string;
    bodyJson: JSONContent;
  },
): Promise<void> {
  try {
    const { data: channelRow, error: channelError } = await admin
      .from("channels")
      .select("workspace_id, kind")
      .eq("id", params.channelId)
      .maybeSingle();

    if (channelError || !channelRow) {
      logger.error("sendMessage: notify - channel lookup failed (non-fatal)", { error: channelError });
      return;
    }

    const kindByUser = new Map<
      string,
      "mention" | "chat_dm" | "chat_thread_reply"
    >();

    // (1) mentions -- re-derived against real channel_members, never
    // trusting the client's bodyJson mention list, same rule
    // lib/comments/mentions.ts documents for the task/comment path.
    const mentionedIds = Array.from(extractMentionIds(params.bodyJson)).filter(
      (id) => id !== params.senderId,
    );
    if (mentionedIds.length > 0) {
      const { data: memberRows, error: memberError } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", params.channelId)
        .in("user_id", mentionedIds);

      if (memberError) {
        logger.error("sendMessage: notify - mention member lookup failed (non-fatal)", { error: memberError });
      } else {
        for (const row of memberRows ?? []) {
          kindByUser.set(row.user_id as string, "mention");
        }
      }
    }

    // (2) DM: every other member, any message. (3) thread reply: every
    // other thread participant. Mutually exclusive per the doc comment
    // above -- a DM's threaded reply still resolves via (2), not (3).
    if (channelRow.kind === "dm") {
      const { data: memberRows, error: memberError } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", params.channelId)
        .neq("user_id", params.senderId);

      if (memberError) {
        logger.error("sendMessage: notify - dm member lookup failed (non-fatal)", { error: memberError });
      } else {
        for (const row of memberRows ?? []) {
          const id = row.user_id as string;
          if (!kindByUser.has(id)) kindByUser.set(id, "chat_dm");
        }
      }
    } else if (params.parentMessageId) {
      const { data: threadRows, error: threadError } = await admin
        .from("messages")
        .select("sender_id")
        .or(
          `id.eq.${params.parentMessageId},parent_message_id.eq.${params.parentMessageId}`,
        );

      if (threadError) {
        logger.error("sendMessage: notify - thread participant lookup failed (non-fatal)", { error: threadError });
      } else {
        for (const row of threadRows ?? []) {
          const id = row.sender_id as string;
          if (id === params.senderId) continue;
          if (!kindByUser.has(id)) kindByUser.set(id, "chat_thread_reply");
        }
      }
    }

    if (kindByUser.size === 0) return;

    // Faza D: preference gate. A parallel, chat-specific implementation
    // of lib/notifications/preferences.ts's filterRecipientsByInAppPreference
    // (same fail-open-on-error, no-row-means-enabled posture) rather than
    // extending that function's NotificationKind-typed map -- chat_dm/
    // chat_thread_reply are a separate ChatNotificationKind, per
    // lib/notifications/fanout.ts's doc comment on why.
    const recipientIds = Array.from(kindByUser.keys());
    const { data: prefRows, error: prefError } = await admin
      .from("notification_preferences")
      .select("user_id, mention_in_app, chat_dm_in_app, chat_thread_reply_in_app")
      .in("user_id", recipientIds);

    if (prefError) {
      logger.error("sendMessage: notify - preferences read failed (fail-open, non-fatal)", { error: prefError });
    }

    const prefByUser = new Map((prefRows ?? []).map((row) => [row.user_id, row]));

    for (const [recipientId, kind] of kindByUser) {
      const pref = prefByUser.get(recipientId);
      if (pref) {
        const enabled =
          kind === "mention"
            ? pref.mention_in_app
            : kind === "chat_dm"
              ? pref.chat_dm_in_app
              : pref.chat_thread_reply_in_app;
        if (enabled === false) continue;
      }

      await createNotification(
        supabase,
        {
          userId: recipientId,
          workspaceId: channelRow.workspace_id as string,
          kind,
          // F13: no task_id for a chat notification -- channelId/messageId
          // are carried in payload instead (see create-notification.ts's
          // doc comment on why comment_id can't be reused for a message
          // id). Faza D: a chat_thread_reply's `messageId` is a REPLY,
          // which never appears in the main channel list (getChannelMessages
          // filters to parent_message_id is null) -- `parentMessageId` is
          // included so the notification's link can open the right thread
          // panel directly instead of landing on a channel view with
          // nothing to scroll to (see chatNotificationHref/ChannelView).
          payload: {
            channelId: params.channelId,
            messageId: params.messageId,
            ...(params.parentMessageId ? { parentMessageId: params.parentMessageId } : {}),
          },
        },
        "sendMessage",
      );
    }
  } catch (notifyError) {
    logger.error("sendMessage: notify failed (non-fatal)", { error: notifyError });
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
    logger.error("sendMessage: linking attachments failed", { error: linkError });
    return [];
  }

  const attachments: ChatMessageAttachment[] = [];
  for (const row of linked) {
    const { data: signedUrlData, error: signedUrlError } = await admin.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrl(row.storage_path, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);

    if (signedUrlError) {
      logger.error("sendMessage: signed URL generation failed for attachment", { error: signedUrlError });
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
// Faza A (docs/chat-slack-parity-plan.md, BUG-2): merges in each thread
// message's attachments (parent + every reply) before returning -- same
// gap as the main channel list (getChannelMessages never joins
// message_attachments either), fixed here in one place since ThreadPanel
// has no other server round-trip to piggyback a second fetch onto.
// Attachments carry `storagePath` only (no signed URL is minted here) --
// ChatAttachment mints one client-side on demand, same as the main list.
export async function getThreadMessagesAction(
  parentMessageId: string,
): Promise<ChatMessage[]> {
  const messages = await getThreadMessages(parentMessageId);
  const attachmentsByMessage = await getMessageAttachments(
    messages.map((m) => m.id),
  );
  if (attachmentsByMessage.size === 0) return messages;
  return messages.map((m) => {
    const attachments = attachmentsByMessage.get(m.id);
    return attachments ? { ...m, attachments } : m;
  });
}

// W10 (pagination hardening): thin Server Action wrapper so the
// client-side ChannelView/MessageList "Load earlier messages" button can
// call the server-only getChannelMessages query for an older page (same
// "wrap the query in an action" convention as getThreadMessagesAction
// above) -- returns messages newest-first, same shape getChannelMessages
// itself returns; the caller re-sorts/prepends.
export async function getChannelMessagesAction(
  channelId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessage[]> {
  const messages = await getChannelMessages(channelId, options);
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid message.",
    };
  }

  const { supabase, user } = await getCurrentUser();

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
  // AS-071: bare URLs (no link mark yet, e.g. never followed by a trailing
  // space before the message was sent) get linkified here, before the
  // plain-text projection is derived from the same document.
  const linkedBodyJson = autolinkBody(parsed.data.bodyJson as JSONContent);

  // BUG FIX (confirmed live: empty-body messages in the messages table --
  // sender name + timestamp, no text, no attachment): the client-side
  // composer guard (message-composer.tsx's isEmptyDoc/submit) is
  // defense-in-depth only, not the enforcement boundary -- a stale client
  // bundle, a race between two rapid Enter presses, or any future caller of
  // this Server Action could still submit a Tiptap doc that projects to
  // empty/whitespace-only plain text. This is the authoritative,
  // server-side guard: reject the insert outright unless there is either
  // real text content OR at least one attachment being linked, matching
  // the same "text or attachment" allowance the composer's own submit()
  // gate documents. Returns a normal `{ ok: false }` result (not a thrown
  // error) so the composer's existing `if (!result.ok) setError(...)`
  // handling surfaces this cleanly instead of leaving the send button
  // stuck -- no silent no-op.
  const hasText = extractPlainText(linkedBodyJson).length > 0;
  const hasAttachments = (attachmentIds ?? []).length > 0;
  if (!hasText && !hasAttachments) {
    return {
      ok: false,
      error: "Message can't be empty.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      channel_id: parsed.data.channelId,
      sender_id: user.id,
      body_json: toPlainJson(linkedBodyJson),
      body_text: extractPlainText(linkedBodyJson),
      parent_message_id: parsed.data.parentMessageId ?? null,
    })
    .select(
      "id, channel_id, sender_id, body_json, parent_message_id, edited_at, deleted_at, created_at",
    )
    .single();

  if (insertError || !inserted) {
    logger.error("sendMessage: insert failed", { error: insertError });
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

  // F13/Faza D: fire-and-forget style (awaited, but errors inside are
  // already caught and logged non-fatally) -- a notification failure must
  // never fail the message send itself, same convention as every other
  // post-write notification side effect in this codebase.
  await notifyChatMessageRecipients(supabase, admin, {
    channelId: parsed.data.channelId,
    messageId: inserted.id,
    parentMessageId: parsed.data.parentMessageId ?? null,
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

  const { supabase, user } = await getCurrentUser();

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

  // AS-071: same autolink pass as sendMessage, applied on edit too.
  const linkedBodyJson = autolinkBody(parsed.data.bodyJson as JSONContent);

  // BUG FIX: same authoritative empty-content guard as sendMessage --
  // editMessage has no attachmentIds parameter, so unlike sendMessage the
  // bar here is simply "must have real text left" (editing a message down
  // to nothing should go through deleteMessage instead).
  if (extractPlainText(linkedBodyJson).length === 0) {
    return {
      ok: false,
      error: "Message can't be empty.",
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("messages")
    .update({
      body_json: toPlainJson(linkedBodyJson),
      body_text: extractPlainText(linkedBodyJson),
      edited_at: editedAt,
    })
    .eq("id", parsed.data.messageId)
    .select("id, body_json, edited_at")
    .single();

  if (updateError || !updated) {
    logger.error("editMessage: update failed", { error: updateError });
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

  const { supabase, user } = await getCurrentUser();

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
    logger.error("deleteMessage: update failed", { error: updateError });
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
