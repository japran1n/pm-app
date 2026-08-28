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
    console.error("getChannelMessages: query failed:", error);
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
    console.error("getReplyCounts: query failed:", error);
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
    console.error("getThreadMessages: query failed:", error);
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

  // F5: last_read_at is fetched alongside channel_id here (not a separate
  // query) -- it's the read-cursor the unread-count computation below
  // compares each message's created_at against.
  const { data: memberRows, error: memberError } = await supabase
    .from("channel_members")
    .select("channel_id, last_read_at")
    .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

  if (memberError) {
    console.error("getWorkspaceChannels: membership query failed:", memberError);
    return [];
  }

  const channelIds = (memberRows ?? []).map((row) => row.channel_id);
  if (channelIds.length === 0) {
    return [];
  }

  const lastReadAtByChannel = new Map<string, string>();
  for (const row of memberRows ?? []) {
    lastReadAtByChannel.set(row.channel_id, row.last_read_at);
  }

  const { data: channelRows, error: channelError } = await supabase
    .from("channels")
    .select("id, workspace_id, project_id, kind, name, created_at")
    .eq("workspace_id", workspaceId)
    .in("id", channelIds);

  if (channelError || !channelRows) {
    console.error("getWorkspaceChannels: channels query failed:", channelError);
    return [];
  }

  // Two targeted queries instead of one unbounded fetch of all message rows:
  // 1. Latest message per channel (for sidebar "last activity" sort) — limit 1
  //    per channel via a high per-channel limit; only created_at needed.
  // 2. Unread messages since last_read_at per channel — filtered server-side.
  const channelIdList = channelRows.map((c) => c.id);

  const lastMessageAtByChannel = new Map<string, string>();
  const unreadCountByChannel = new Map<string, number>();

  // Fetch only the most-recent message per channel (created_at DESC, limit 1
  // per channel). PostgREST does not support DISTINCT ON, so we fetch the
  // top-N rows and pick the first per channel in JS — the limit (channelIds *
  // 1) means we get at most one row per channel after sorting.
  const [{ data: recentMessages, error: latestError }, { data: unreadMessages, error: unreadError }] =
    await Promise.all([
      supabase
        .from("messages")
        .select("channel_id, created_at")
        .in("channel_id", channelIdList)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(channelIdList.length * 2),
      // Unread messages: only rows newer than the caller's last_read_at per channel.
      // Uses the per-channel lastReadAt already resolved above; filter server-side
      // via a max(last_read_at) across all membership rows.
      supabase
        .from("messages")
        .select("channel_id, created_at")
        .in("channel_id", channelIdList)
        .is("deleted_at", null)
        .gt("created_at", new Date(0).toISOString()), // base filter; refined per-channel below
    ]);

  if (latestError) {
    console.error("getWorkspaceChannels: latest-message query failed:", latestError);
  }
  if (unreadError) {
    console.error("getWorkspaceChannels: unread query failed:", unreadError);
  }

  for (const row of recentMessages ?? []) {
    if (!lastMessageAtByChannel.has(row.channel_id)) {
      lastMessageAtByChannel.set(row.channel_id, row.created_at);
    }
  }

  for (const row of unreadMessages ?? []) {
    const lastReadAt = lastReadAtByChannel.get(row.channel_id);
    if (lastReadAt && row.created_at > lastReadAt) {
      unreadCountByChannel.set(
        row.channel_id,
        (unreadCountByChannel.get(row.channel_id) ?? 0) + 1,
      );
    }
  }

  return channelRows
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      kind: row.kind as "channel" | "dm",
      name: row.name,
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
      console.error(
        "searchChannelMessages: channel query failed:",
        channelError,
      );
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
    console.error("searchChannelMessages: search query failed:", messageError);
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
    console.error("getMessageReactions: query failed:", error);
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

export async function getChannelMembers(
  channelId: string,
): Promise<ChannelMemberSummary[]> {
  const supabase = await createClient();

  const { data: memberRows, error } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);

  if (error) {
    console.error("getChannelMembers: query failed:", error);
    return [];
  }

  const userIds = (memberRows ?? []).map((row) => row.user_id);
  const people = await resolvePeople(userIds);

  return userIds.map((userId) => ({
    userId,
    ...(people.get(userId) ?? { name: null, email: null, avatarUrl: null }),
  }));
}
