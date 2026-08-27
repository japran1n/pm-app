// F4 (docs/advanced-chat-plan.md): shared chrome for every /chat/* page --
// the channel list panel alongside whichever thread view `children` is.
//
// Desktop: channel list + thread render side by side (`md:flex`).
// Mobile: the list panel is hidden here (`hidden md:flex`) -- the plan's
// acceptance criteria requires "one screen at a time" on narrow viewports,
// same convention as the M17 mobile board. `/chat` (this segment's own
// page.tsx, no channelId) renders its own full-width, `md:hidden` copy of
// the channel list for mobile, so a phone shows either the channel list
// (at `/chat`) or the open thread (at `/chat/[channelId]`) as two distinct
// routes/screens, never both at once -- while desktop always sees both via
// this layout's own always-mounted panel.
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceChannels } from "@/lib/queries/chat";
import { ChatNavList } from "@/components/chat/chat-nav-list";
import { ChatMessageSearch } from "@/components/chat/chat-message-search";

export default async function ChatLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect(`/w/${workspaceSlug}`);
  }

  const channels = await getWorkspaceChannels(workspace.id);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r md:flex">
        <ChatMessageSearch workspaceSlug={workspaceSlug} workspaceId={workspace.id} />
        <ChatNavList
          workspaceSlug={workspaceSlug}
          workspaceId={workspace.id}
          channels={channels.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            unreadCount: c.unreadCount,
          }))}
        />
      </aside>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
