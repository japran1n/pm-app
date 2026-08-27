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

  // One aggregate query for both "latest message per channel" (F2) and
  // "unread count per channel" (F5) -- fetch every message row for this
  // caller's channels once and reduce client-side, rather than an N+1
  // per-channel query for either computation.
  const { data: latestMessages, error: latestError } = await supabase
    .from("messages")
    .select("channel_id, created_at")
    .in("channel_id", channelRows.map((c) => c.id))
    .order("created_at", { ascending: false });

  if (latestError) {
    console.error("getWorkspaceChannels: latest-message query failed:", latestError);
  }

  const lastMessageAtByChannel = new Map<string, string>();
  const unreadCountByChannel = new Map<string, number>();
  for (const row of latestMessages ?? []) {
    if (!lastMessageAtByChannel.has(row.channel_id)) {
      lastMessageAtByChannel.set(row.channel_id, row.created_at);
    }

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
