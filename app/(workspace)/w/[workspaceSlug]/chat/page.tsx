// F4 (docs/advanced-chat-plan.md): `/chat` index. Mobile (narrow viewport,
// where the layout's channel list panel is `hidden`) renders its own
// full-width channel list as the useful "first screen" here -- there's no
// thread pane to fall back into on that layout. Desktop (where the
// layout's list panel is always visible alongside `children`) has no use
// for a blank thread pane, so <DesktopAutoRedirect> jumps straight into
// the caller's first channel (same "most recent activity" order
// getWorkspaceChannels sorts by) once mounted above the `md` breakpoint --
// done client-side (not a server redirect) specifically so the mobile
// "back to channel list" link in channel-view.tsx has somewhere stable to
// return to instead of being bounced straight back into the same channel.
import { MessageCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceChannels, getDmCandidates } from "@/lib/queries/chat";
import { ChatNavList } from "@/components/chat/chat-nav-list";
import { ChatMessageSearch } from "@/components/chat/chat-message-search";
import { DesktopAutoRedirect } from "@/components/chat/desktop-auto-redirect";
import { DmStarterList } from "@/components/chat/dm-starter-list";

export default async function ChatIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [channels, dmCandidates] = await Promise.all([
    workspace ? getWorkspaceChannels(workspace.id) : Promise.resolve([]),
    workspace && user ? getDmCandidates(workspace.id, user.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {channels.length > 0 && (
          <DesktopAutoRedirect href={`/w/${workspaceSlug}/chat/${channels[0].id}`} />
        )}
        {workspace && (
          <ChatMessageSearch workspaceSlug={workspaceSlug} workspaceId={workspace.id} />
        )}
        <ChatNavList
          workspaceSlug={workspaceSlug}
          workspaceId={workspace?.id ?? null}
          channels={channels
            .filter((c) => c.kind === "channel")
            .map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              unreadCount: c.unreadCount,
            }))}
        />
        {workspace && (
          <DmStarterList
            workspaceSlug={workspaceSlug}
            workspaceId={workspace.id}
            existingDms={channels
              .filter((c) => c.kind === "dm")
              .map((c) => ({ id: c.id, name: c.name, unreadCount: c.unreadCount }))}
            candidates={dmCandidates}
          />
        )}
      </div>
      {/* Desktop (layout.tsx's aside is always visible there, this route
       * only ever renders when no channel is selected): empty state
       * instead of a blank thread pane. */}
      <div className="hidden min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center md:flex">
        <MessageCircle
          className="size-10 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="text-mini text-muted-foreground">
          Select a conversation to start messaging
        </p>
      </div>
    </>
  );
}
