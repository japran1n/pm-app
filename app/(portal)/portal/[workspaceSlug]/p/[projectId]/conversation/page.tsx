import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getChannelMessages, getChannelMembers, getReplyCounts } from "@/lib/queries/chat";
import { createClient } from "@/lib/supabase/server";
import { ChannelView } from "@/components/chat/channel-view";
import { EmptyState } from "@/components/empty-state";

// F116 (docs/client-portal-phase-2-plan.md item A): the portal's
// conversation view. Reuses the same ChannelView Client Component the
// staff-side `/w/<slug>/chat/<channelId>` route already renders (this file
// mirrors that route's own Server Component shape almost exactly -- see
// app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx) rather than
// building a second chat UI, per this feature's own "do not build a
// messaging system" instruction.
//
// Project resolution goes through `getPortalProjects`, the same RLS +
// `portal_enabled` filtered list every other portal view in this segment
// uses (see e.g. site/page.tsx's own comment) -- a project that doesn't
// exist, isn't shared with this client, or has `portal_enabled = false`
// all end at the same notFound(), same AS-007-style convention.
//
// The channel itself is looked up by `project_id` + `kind = 'channel'`
// rather than by a stored id anywhere in the portal's own tables --
// `ensure_project_channel_atomic` (20261103010000) is this project's
// single source of truth for which channel that is, and RLS's
// `channels_select_members_or_workspace` policy is what actually decides
// whether this client may see it (an explicit `channel_members` row,
// never workspace-visibility browsing -- see that migration's own header
// comment for why). A project whose portal just turned on a moment ago,
// before `ensure_project_channel_atomic` has run, or a client not yet
// backfilled onto it, gets the honest empty state below instead of a 500 --
// silence here reads as "not started yet", not as broken.
export default async function PortalConversationPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const workspaceProjects = await getPortalProjects(
    (
      await supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle()
    ).data?.id ?? "",
  );
  const project = workspaceProjects.find((p) => p.id === projectId);
  if (!project) notFound();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, name")
    .eq("project_id", projectId)
    .eq("kind", "channel")
    .maybeSingle();

  if (!channel) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={MessageSquare}
          title="No conversation yet"
          description="Once your team starts this project's conversation, you'll see it here."
          testId="portal-conversation-empty"
        />
      </div>
    );
  }

  const [messages, members, replyCounts] = await Promise.all([
    getChannelMessages(channel.id),
    getChannelMembers(channel.id),
    getReplyCounts(channel.id),
  ]);

  return (
    <ChannelView
      workspaceSlug={workspaceSlug}
      channelId={channel.id}
      channelName={channel.name ?? project.name}
      initialMessages={messages}
      members={members}
      currentUserId={user.id}
      initialReplyCounts={replyCounts}
    />
  );
}
