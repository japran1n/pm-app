import { logger } from "@/lib/observability/logger";

// F2/F3/F4 (docs/advanced-chat-plan.md): read queries for chat channels and
// a channel's messages.
import "server-only";

import type { JSONContent } from "@tiptap/react";

import { createClient } from "@/lib/supabase/server";
import { resolvePeople, type PersonSummary } from "@/lib/queries/people";

export type ChatMessageRow = {
  id: string;
  channelId: string;
  senderId: string;
  bodyJson: JSONContent;
  parentMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

const MESSAGE_COLUMNS =
  "id, channel_id, sender_id, body_json, parent_message_id, edited_at, deleted_at, created_at";

function toChatMessageRow(row: {
  id: string;
  channel_id: string;
  sender_id: string;
  body_json: unknown;
  parent_message_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}): ChatMessageRow {
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

/**
 * Loads a page of top-level messages (`parent_message_id is null` -- F10's
 * thread replies are excluded from the main channel list) for `channelId`,
 * newest-first, for use as an initial load or a "load more" (older
 * messages) page keyed by a `created_at` cursor. RLS's
 * `messages_select_channel_members` policy is the real access boundary --
 * this query runs through the caller's own session (never the admin
 * client), so a non-member simply gets an empty result rather than this
 * query needing its own membership re-check.
 */
export async function getChannelMessages(
  channelId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessageRow[]> {
  const limit = options?.limit ?? 50;
  const supabase = await createClient();

  let query = supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("channel_id", channelId)
    .is("parent_message_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.before) {
    query = query.lt("created_at", options.before);
  }

  const { data, error } = await query;

  if (error || !data) {
    logger.error("getChannelMessages: query failed", { error: error });
    return [];
  }

  return data.map(toChatMessageRow);
}

/**
 * F10 (docs/advanced-chat-plan.md): reply counts for a batch of top-level
 * messages in `channelId` -- one aggregate query (all rows with a non-null
 * `parent_message_id` in this channel, reduced client-side) rather than an
 * N+1 count-per-message query, same convention `getWorkspaceChannels`
 * above documents for its own latest-message/unread-count computation.
 * Runs through the caller's own session; RLS's
 * `messages_select_channel_members` is the real access boundary.
 */
export async function getReplyCounts(
  channelId: string,
): Promise<Record<string, number>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("parent_message_id")
    .eq("channel_id", channelId)
    .not("parent_message_id", "is", null);

  if (error || !data) {
    logger.error("getReplyCounts: query failed", { error: error });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data) {
    const parentId = row.parent_message_id;
    if (!parentId) continue;
    counts[parentId] = (counts[parentId] ?? 0) + 1;
  }
  return counts;
}

/**
 * F10: the full thread for `parentMessageId` -- the original (top-level)
 * message plus every reply, oldest-first. Returns an empty array if the
 * parent message doesn't exist or isn't visible to the caller (RLS's
 * `messages_select_channel_members` is the real access boundary, same as
 * every other query in this file).
 */
export async function getThreadMessages(
  parentMessageId: string,
): Promise<ChatMessageRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .or(`id.eq.${parentMessageId},parent_message_id.eq.${parentMessageId}`)
    .order("created_at", { ascending: true });

  if (error || !data) {
    logger.error("getThreadMessages: query failed", { error: error });
    return [];
  }

  return data.map(toChatMessageRow);
}

// ---------------------------------------------------------------------
// F2: workspace channel list
// ---------------------------------------------------------------------

export type WorkspaceChannelRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  kind: "channel" | "dm";
  name: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  /** F5: count of messages with `created_at > channel_members.last_read_at`
   * for the caller, in this channel. */
  unreadCount: number;
};

/**
 * Channels the caller is a member of, for `workspaceId`, sorted by most
 * recent activity (last message time, falling back to the channel's own
 * `created_at` when it has no messages yet -- per F2's spec). Runs through
 * the caller's own session: `channels_select_members_or_workspace` /
 * `channel_members_select_own_or_shared_channel` RLS is the real filter,
 * this query just orders + shapes the result.
 */
export async function getWorkspaceChannels(
  workspaceId: string,
): Promise<WorkspaceChannelRow[]> {
  const supabase = await createClient();

  // F5/W3: last_read_at itself is no longer read here -- the summary RPC
  // below re-derives it from the caller's own channel_members row via
  // auth.uid() (security definer), which is also the access boundary that
  // stops one user from reading another user's read-cursor. This query
  // only needs the set of channel ids the caller belongs to.
  const { data: memberRows, error: memberError } = await supabase
    .from("channel_members")
    .select("channel_id")
    .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

  if (memberError) {
    logger.error("getWorkspaceChannels: membership query failed", { error: memberError });
    return [];
  }

  const channelIds = (memberRows ?? []).map((row) => row.channel_id);
  if (channelIds.length === 0) {
    return [];
  }

  const { data: channelRows, error: channelError } = await supabase
    .from("channels")
    .select("id, workspace_id, project_id, kind, name, created_at")
    .eq("workspace_id", workspaceId)
    .in("id", channelIds);

  if (channelError || !channelRows) {
    logger.error("getWorkspaceChannels: channels query failed", { error: channelError });
    return [];
  }

  // W3: last-message-per-channel and unread-count-per-channel are both
  // computed in a single RPC round-trip (`get_chat_channel_summaries`)
  // rather than fetching message rows into JS. PostgREST can't express
  // `DISTINCT ON`, and a global `order + limit` (the old approach) doesn't
  // guarantee one row per channel; a naive unread query without a
  // real per-channel date filter can also silently truncate under
  // PostgREST's max-rows cap. The RPC derives the caller's own channels
  // and last_read_at from auth.uid() internally (security definer), so it
  // cannot be used to read another user's read-cursor.
  const channelIdList = channelRows.map((c) => c.id);

  const lastMessageAtByChannel = new Map<string, string>();
  const unreadCountByChannel = new Map<string, number>();

  const { data: summaries, error: summaryError } = await supabase.rpc(
    "get_chat_channel_summaries",
    { p_channel_ids: channelIdList },
  );

  if (summaryError) {
    logger.error("getWorkspaceChannels: channel summary RPC failed", { error: summaryError });
  }

  for (const row of summaries ?? []) {
    if (row.last_message_at) {
      lastMessageAtByChannel.set(row.channel_id, row.last_message_at);
    }
    unreadCountByChannel.set(row.channel_id, Number(row.unread_count ?? 0));
  }

  // DM rows carry no `name` (channels_channel_kind_requires_name only
  // applies to kind='channel') -- resolve the other member's display name
  // here so the sidebar shows a person, not a generic "Direct message"
  // label, mirroring the same resolution the
  // `app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx` thread
  // view already does for the open channel.
  const dmChannelIds = channelRows.filter((row) => row.kind === "dm").map((row) => row.id);
  const dmOtherNameByChannel = new Map<string, string>();
  if (dmChannelIds.length > 0) {
    const currentUserId = (await supabase.auth.getUser()).data.user?.id ?? "";
    const { data: dmMemberRows } = await supabase
      .from("channel_members")
      .select("channel_id, user_id")
      .in("channel_id", dmChannelIds);

    const otherUserIdByChannel = new Map<string, string>();
    for (const row of dmMemberRows ?? []) {
      if (row.user_id !== currentUserId) {
        otherUserIdByChannel.set(row.channel_id, row.user_id);
      }
    }
    const otherUserIds = Array.from(new Set(otherUserIdByChannel.values()));
    const people = await resolvePeople(otherUserIds);
    for (const [channelId, otherUserId] of otherUserIdByChannel) {
      const person = people.get(otherUserId);
      dmOtherNameByChannel.set(channelId, person?.name ?? person?.email ?? "Direct message");
    }
  }

  return channelRows
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      kind: row.kind as "channel" | "dm",
      name: row.kind === "dm" ? (dmOtherNameByChannel.get(row.id) ?? row.name) : row.name,
      createdAt: row.created_at,
      lastMessageAt: lastMessageAtByChannel.get(row.id) ?? null,
      unreadCount: unreadCountByChannel.get(row.id) ?? 0,
    }))
    .sort((a, b) => {
      const aTime = a.lastMessageAt ?? a.createdAt;
      const bTime = b.lastMessageAt ?? b.createdAt;
      return bTime.localeCompare(aTime);
    });
}

// ---------------------------------------------------------------------
// F4: channel member display names, for resolving each message's sender
// in the thread view without an N+1 lookup per message.
// ---------------------------------------------------------------------

export type MessageSearchResult = {
  id: string;
  channelId: string;
  channelName: string | null;
  channelKind: "channel" | "dm";
  senderId: string;
  senderName: string | null;
  snippet: string;
  createdAt: string;
};

/**
 * F12 (docs/advanced-chat-plan.md): full-text search over
 * `messages.body_text` (populated by lib/actions/chat-messages.ts's
 * sendMessage/editMessage via lib/comments/rich-text.ts's
 * extractPlainText, indexed by supabase/migrations/
 * 20260904030000_messages_search.sql's
 * `messages_body_text_search_idx` GIN index on
 * `to_tsvector('english', body_text)`).
 *
 * Runs through the caller's own session -- RLS's
 * `messages_select_channel_members` is the real access boundary, same
 * convention as every other query in this file, so this naturally never
 * returns a message from a channel the caller isn't a member of (F12's
 * acceptance criterion) without this function needing its own membership
 * check.
 *
 * Uses PostgREST's `.textSearch(..., { type: "plain" })`, i.e.
 * `plainto_tsquery('english', query)` rather than raw `to_tsquery` --
 * `to_tsquery` throws a Postgres error on arbitrary punctuation/operators
 * a user might type (`"foo & (bar"`), which `plainto_tsquery` tolerates by
 * design. PostgREST's `fts` filter still compares against
 * `to_tsvector('english', body_text)`, the exact expression the GIN index
 * above is built on, so the planner can still pick an index scan.
 *
 * `workspaceId` scopes the search to one workspace's channels (matching
 * the plan's "search channel messages" framing and this UI's
 * per-workspace chat sidebar) -- a two-step query (channel ids, then
 * messages) rather than a single query with an embedded join, mirroring
 * `getWorkspaceChannels`'s own two-query shape above.
 */
export async function searchChannelMessages(
  workspaceId: string,
  query: string,
  limit = 20,
): Promise<MessageSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = await createClient();

  const { data: channelRows, error: channelError } = await supabase
    .from("channels")
    .select("id, name, kind")
    .eq("workspace_id", workspaceId);

  if (channelError || !channelRows || channelRows.length === 0) {
    if (channelError) {
      logger.error("searchChannelMessages: channel query failed", { error: channelError });
    }
    return [];
  }

  const channelById = new Map(
    channelRows.map((c) => [c.id, { name: c.name, kind: c.kind }]),
  );
  const channelIds = channelRows.map((c) => c.id);

  const { data: messageRows, error: messageError } = await supabase
    .from("messages")
    .select("id, channel_id, sender_id, body_text, created_at")
    .in("channel_id", channelIds)
    .is("deleted_at", null)
    .textSearch("body_text", trimmed, { type: "plain", config: "english" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (messageError) {
    logger.error("searchChannelMessages: search query failed", { error: messageError });
    return [];
  }

  const people = await resolvePeople(
    Array.from(new Set((messageRows ?? []).map((r) => r.sender_id))),
  );

  return (messageRows ?? []).map((row) => {
    const channel = channelById.get(row.channel_id);
    return {
      id: row.id,
      channelId: row.channel_id,
      channelName: channel?.name ?? null,
      channelKind: (channel?.kind as "channel" | "dm") ?? "channel",
      senderId: row.sender_id,
      senderName: people.get(row.sender_id)?.name ?? null,
      snippet: row.body_text as string,
      createdAt: row.created_at,
    };
  });
}

export type ChannelMemberSummary = PersonSummary & { userId: string };

/**
 * Every member of `channelId`, with display name/avatar resolved via the
 * same shared `resolvePeople` batched lookup every other member list in
 * this codebase uses (lib/queries/members.ts, lib/queries/assignee-names.ts)
 * -- one batched query, not one per sender. Runs through the caller's own
 * session for the membership ids themselves (RLS's
 * `channel_members_select_own_or_shared_channel` is the real access
 * boundary); `resolvePeople` itself uses the admin client only to resolve
 * a display value for ids already permitted, same justification as those
 * other call sites.
 */
// ---------------------------------------------------------------------
// F8: emoji reactions on a channel's messages.
// ---------------------------------------------------------------------

export type MessageReactionSummary = {
  emoji: string;
  /** User ids of everyone currently reacting with this emoji. */
  userIds: string[];
};

/**
 * All reactions across `messageIds`, grouped by message id. One batched
 * query (not one per message) -- same "batch instead of N+1" convention
 * getChannelMembers documents for resolvePeople. Runs through the
 * caller's own session; RLS's `message_reactions_select_visible` is the
 * real access boundary.
 */
export async function getMessageReactions(
  messageIds: string[],
): Promise<Map<string, MessageReactionSummary[]>> {
  const byMessage = new Map<string, MessageReactionSummary[]>();
  if (messageIds.length === 0) return byMessage;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, emoji, user_id")
    .in("message_id", messageIds);

  if (error) {
    logger.error("getMessageReactions: query failed", { error: error });
    return byMessage;
  }

  for (const row of data ?? []) {
    const reactions = byMessage.get(row.message_id) ?? [];
    const existing = reactions.find((r) => r.emoji === row.emoji);
    if (existing) {
      existing.userIds.push(row.user_id);
    } else {
      reactions.push({ emoji: row.emoji, userIds: [row.user_id] });
    }
    byMessage.set(row.message_id, reactions);
  }

  return byMessage;
}

// ---------------------------------------------------------------------
// Faza A (docs/chat-slack-parity-plan.md, BUG-2): file/image attachments
// for a batch of messages, grouped by message id -- same batched-query
// shape as getMessageReactions above. This was never wired up anywhere
// (F11's own migration doc comment expected "other channel members see it
// on their next message-list load/refresh", but no query or page ever
// called it): the composer uploaded files and sendMessage linked them,
// but nothing re-fetched them for a page load or a channel member who
// wasn't the sender. Deliberately does NOT mint signed URLs here (a
// server-rendered signed URL baked into the initial HTML would sit
// unused for however long the viewer takes to scroll to it, burning
// into its TTL) -- lib/actions/chat-attachments.ts's existing
// getChatAttachmentSignedUrl action mints one on demand, client-side,
// the moment a message actually renders (see ChatAttachment in
// chat-attachment.tsx).
export type ChatMessageAttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  storagePath: string;
};

export async function getMessageAttachments(
  messageIds: string[],
): Promise<Map<string, ChatMessageAttachmentRow[]>> {
  const byMessage = new Map<string, ChatMessageAttachmentRow[]>();
  if (messageIds.length === 0) return byMessage;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, message_id, file_name, mime_type, file_size, storage_path")
    .in("message_id", messageIds);

  if (error) {
    logger.error("getMessageAttachments: query failed", { error: error });
    return byMessage;
  }

  for (const row of data ?? []) {
    if (!row.message_id) continue;
    const list = byMessage.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      storagePath: row.storage_path,
    });
    byMessage.set(row.message_id, list);
  }

  return byMessage;
}

export async function getChannelMembers(
  channelId: string,
): Promise<ChannelMemberSummary[]> {
  const supabase = await createClient();

  const { data: memberRows, error } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);

  if (error) {
    logger.error("getChannelMembers: query failed", { error: error });
    return [];
  }

  const userIds = (memberRows ?? []).map((row) => row.user_id);
  const people = await resolvePeople(userIds);

  return userIds.map((userId) => ({
    userId,
    ...(people.get(userId) ?? { name: null, email: null, avatarUrl: null }),
  }));
}

// ---------------------------------------------------------------------
// Team 1:1 DMs: "who can I start a direct message with" candidate list.
// ---------------------------------------------------------------------

export type DmCandidate = ChannelMemberSummary;

/**
 * Every active workspace member except the caller and except `client`
 * role members -- a DM is a team-internal 1:1, not a client-facing
 * surface (mirrors `channels_select_members_or_workspace`'s own
 * "workspace-wide chat is a team space, never a client" exclusion for
 * plain channels). Runs through the caller's own session:
 * `workspace_members_select_fellow_members` RLS is the real access
 * boundary, same convention `getWorkspaceMembers` (lib/queries/members.ts)
 * documents for itself.
 */
export async function getDmCandidates(
  workspaceId: string,
  currentUserId: string,
): Promise<DmCandidate[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  if (error) {
    logger.error("getDmCandidates: query failed", { error: error });
    return [];
  }

  const userIds = (rows ?? [])
    .filter((row) => row.user_id && row.user_id !== currentUserId && row.role !== "client")
    .map((row) => row.user_id as string);

  if (userIds.length === 0) return [];

  const people = await resolvePeople(userIds);

  return userIds
    .map((userId) => ({
      userId,
      ...(people.get(userId) ?? { name: null, email: null, avatarUrl: null }),
    }))
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
}
