import { logger } from "@/lib/observability/logger";

// F4 (docs/advanced-chat-plan.md): the thread view for one channel --
// Server Component fetches the initial message page + channel + member
// list, ChannelView (Client Component) owns the interactive
// send/realtime/scroll behaviour, same "server-fetched, passed down"
// convention as every other detail view in this codebase.
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getChannelMessages,
  getChannelMembers,
  getReplyCounts,
  getMessageReactions,
  getMessageAttachments,
  getChannelReadReceipts,
} from "@/lib/queries/chat";
import { ChannelView } from "@/components/chat/channel-view";

export default async function ChatChannelPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; channelId: string }>;
}) {
  const { workspaceSlug, channelId } = await params;

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    notFound();
  }

  // RLS's `channels_select_members_or_workspace` is the real access
  // boundary -- a channel the caller isn't a member of (or that doesn't
  // exist) simply returns no row here, same "collapse not-found and
  // not-permitted into one generic 404" convention the workspace layout's
  // own doc comment documents for AS-144.
  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, name, kind")
    .eq("id", channelId)
    .maybeSingle();

  if (channelError) {
    logger.error("ChatChannelPage: channel lookup failed", { error: channelError });
  }

  if (!channel) {
    notFound();
  }

  // P2-14: wave 1 — messages, members, read receipts; getReplyCounts now
  // takes message ids (not channelId), so it moves to wave 2 alongside
  // reactions and attachments, all of which need the message ids first.
  const [messages, members, readReceiptsByUser] = await Promise.all([
    getChannelMessages(channelId),
    getChannelMembers(channelId),
    getChannelReadReceipts(channelId),
  ]);
  const initialReadReceipts = Object.fromEntries(readReceiptsByUser);

  // Faza A (docs/chat-slack-parity-plan.md, BUG-2/3/4/5): reactions,
  // attachments, and reply counts all need message ids from wave 1 --
  // batch them together in wave 2. Converted to plain objects -- Maps
  // don't survive a Server->Client Component prop the way a plain object
  // does, same convention getReplyCounts already established.
  const messageIds = messages.map((m) => m.id);
  const [replyCounts, reactionsByMessage, attachmentsByMessage] = await Promise.all([
    getReplyCounts(messageIds),
    getMessageReactions(messageIds),
    getMessageAttachments(messageIds),
  ]);
  const initialReactions = Object.fromEntries(reactionsByMessage);
  const initialAttachments = Object.fromEntries(attachmentsByMessage);

  const channelName =
    channel.kind === "dm"
      ? members
          .filter((m) => m.userId !== user.id)
          .map((m) => m.name || m.email || m.userId)
          .join(", ") || "Direct message"
      : (channel.name ?? "Channel");

  return (
    <ChannelView
      workspaceSlug={workspaceSlug}
      channelId={channelId}
      channelName={channelName}
      initialMessages={messages}
      members={members}
      currentUserId={user.id}
      initialReplyCounts={replyCounts}
      initialReactions={initialReactions}
      initialAttachments={initialAttachments}
      initialReadReceipts={initialReadReceipts}
    />
  );
}
