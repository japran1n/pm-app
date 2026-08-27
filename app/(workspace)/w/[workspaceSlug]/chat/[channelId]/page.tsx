// F4 (docs/advanced-chat-plan.md): the thread view for one channel --
// Server Component fetches the initial message page + channel + member
// list, ChannelView (Client Component) owns the interactive
// send/realtime/scroll behaviour, same "server-fetched, passed down"
// convention as every other detail view in this codebase.
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getChannelMessages, getChannelMembers, getReplyCounts } from "@/lib/queries/chat";
import { ChannelView } from "@/components/chat/channel-view";

export default async function ChatChannelPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; channelId: string }>;
}) {
  const { workspaceSlug, channelId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    console.error("ChatChannelPage: channel lookup failed:", channelError);
  }

  if (!channel) {
    notFound();
  }

  const [messages, members, replyCounts] = await Promise.all([
    getChannelMessages(channelId),
    getChannelMembers(channelId),
    getReplyCounts(channelId),
  ]);

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
    />
  );
}
