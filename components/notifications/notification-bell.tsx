"use client";

// F208: the bell trigger + popover (AS-379). Client Component only for
// the interactive popover/badge state — initial data is server-fetched by
// the workspace layout and passed down as props, per the clarified
// spec's data-shape answer.
import { useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import type { NotificationListItem } from "@/lib/queries/notifications";

export function NotificationBell({
  workspaceSlug,
  workspaceId,
  initialNotifications,
  initialUnreadCount,
}: {
  workspaceSlug: string;
  workspaceId: string;
  initialNotifications: NotificationListItem[];
  initialUnreadCount: number;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
          >
            <Bell className="size-4" aria-hidden="true" />
            {/* AS-379: a bell shows the unread count. */}
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-2">
        <NotificationPanel
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
          onUnreadCountChange={setUnreadCount}
        />
      </PopoverContent>
    </Popover>
  );
}
