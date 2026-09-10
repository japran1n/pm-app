"use client";

// F4 (docs/advanced-chat-plan.md): the chat sidebar section -- lists every
// channel the caller belongs to, mirrors components/nav/project-nav-list.tsx's
// "collapsible sidebar section" pattern (same primitive, different table).
// Server-fetched by the chat route's own layout/page and passed down as a
// typed prop, same "server-fetched, passed down" convention every other
// sidebar-fed list in this codebase follows.
//
// F5: unread badges -- same visual treatment as notification-bell.tsx's
// badge-count pattern (small destructive Badge, 99+ cap). Two sources feed
// the displayed count: the server-computed `unreadCount` passed in per
// channel (lib/queries/chat.ts's getWorkspaceChannels), and live
// `messages` INSERT events (F5's use-chat-unread-realtime hook, reusing
// F3's same insert event) that bump a channel's count without a re-query.
// The currently-open channel's count is always shown as 0 locally --
// components/chat/channel-view.tsx's markChannelRead call is what makes
// that authoritative server-side; this local zeroing is what satisfies
// F5's "opens within 1-2s" acceptance criterion without waiting on a full
// page re-fetch.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, Hash, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useChatUnreadRealtime } from "@/components/chat/use-chat-unread-realtime";

export type ChatNavChannel = {
  id: string;
  name: string | null;
  kind: "channel" | "dm";
  unreadCount: number;
};

export function ChatNavList({
  workspaceSlug,
  workspaceId,
  channels,
}: {
  workspaceSlug: string;
  /** F5: unique per-workspace key for the unread Realtime subscription's
   * shared topic. Optional so pre-F5 callers/tests that don't pass it keep
   * rendering without realtime unread updates, same "optional, degrades
   * gracefully" convention as NotificationBell's currentUserId. */
  workspaceId?: string | null;
  channels: ChatNavChannel[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(channels.map((c) => [c.id, c.unreadCount])),
  );

  // Server-fetched counts change (new page load / revalidation) --
  // reconcile local state to match rather than keeping stale numbers
  // forever. Adjusted during render (rather than in an effect) so the
  // reconciliation happens in the same render pass as the prop change,
  // instead of a render -> effect -> extra render cascade.
  const [prevChannels, setPrevChannels] = useState(channels);
  if (channels !== prevChannels) {
    setPrevChannels(channels);
    setUnreadCounts(Object.fromEntries(channels.map((c) => [c.id, c.unreadCount])));
  }

  const channelHrefById = useMemo(
    () =>
      new Map(channels.map((c) => [c.id, `/w/${workspaceSlug}/chat/${c.id}`])),
    [channels, workspaceSlug],
  );

  useChatUnreadRealtime(workspaceId, (event) => {
    const href = channelHrefById.get(event.channelId);
    if (!href) return;
    // The channel this event belongs to is currently open -- ChannelView's
    // markChannelRead call is already handling the server-side read
    // cursor for it, so don't increment a badge the user is looking at.
    if (pathname === href) return;
    setUnreadCounts((previous) => ({
      ...previous,
      [event.channelId]: (previous[event.channelId] ?? 0) + 1,
    }));
  });

  // F5 acceptance: "Otvaranje kanala nulira broj u roku od 1-2 sekunde" --
  // zero the active channel's local badge immediately on navigation, rather
  // than waiting for a fresh server round-trip. Adjusted during render
  // (rather than in an effect keyed on pathname) so the badge clears in the
  // same render pass as the navigation, not a render -> effect -> extra
  // render cascade.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const activeChannel = channels.find(
      (c) => pathname === channelHrefById.get(c.id),
    );
    if (activeChannel && unreadCounts[activeChannel.id] !== 0) {
      setUnreadCounts((previous) => ({
        ...previous,
        [activeChannel.id]: 0,
      }));
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex min-h-0 flex-shrink flex-col border-t"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex min-h-9 items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:text-sidebar-foreground max-md:min-h-11"
          >
            <span>Chat</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        }
      />
      <CollapsibleContent className="min-h-0 overflow-y-auto">
        {channels.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-sidebar-foreground/60">
            No channels yet.
          </p>
        ) : (
          <nav aria-label="Chat channels" className="flex flex-col gap-0.5 px-2 pb-2">
            {channels.map((channel) => {
              const href = channelHrefById.get(channel.id)!;
              const isActive = pathname === href;
              const Icon = channel.kind === "dm" ? MessageCircle : Hash;
              const unreadCount = unreadCounts[channel.id] ?? 0;
              return (
                <Link
                  key={channel.id}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={
                    unreadCount > 0
                      ? `${channel.name ?? "Direct message"}, ${unreadCount} unread`
                      : undefined
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors max-md:min-h-11",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-muted/50 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon
                    className="size-3.5 shrink-0 text-sidebar-foreground/50"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {channel.name ?? "Direct message"}
                  </span>
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="h-4 min-w-4 shrink-0 rounded-full px-1 font-mono text-[10px] leading-none"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
