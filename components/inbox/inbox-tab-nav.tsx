import Link from "next/link";

import { cn } from "@/lib/utils";

export type InboxTabKey = "all" | "notifications" | "approvals" | "requests" | "watching";

const TAB_LABELS: Record<InboxTabKey, string> = {
  all: "All",
  notifications: "Notifications",
  approvals: "Approvals",
  requests: "Requests",
  watching: "Watching",
};

// F013 (SB-050): Link-based tabs (`?tab=`), not client-state tabs -- each
// tab is a real, bookmarkable/shareable URL, consistent with every other
// filter in this app (e.g. Projects' `?filter=archived`, F012/SB-046).
export function InboxTabNav({
  workspaceSlug,
  activeTab,
  visibleTabs,
}: {
  workspaceSlug: string;
  activeTab: InboxTabKey;
  visibleTabs: InboxTabKey[];
}) {
  return (
    <nav aria-label="Inbox tabs" className="flex flex-wrap gap-1 border-b pb-2">
      {visibleTabs.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <Link
            key={tab}
            href={tab === "all" ? `/w/${workspaceSlug}/inbox` : `/w/${workspaceSlug}/inbox?tab=${tab}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
