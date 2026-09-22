import Link from "next/link";

import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { getOpenApprovalsForWorkspace } from "@/lib/queries/approvals";
import { getWorkspaceClientRequests } from "@/lib/queries/client-requests";
import { getWatchedTasksForUser } from "@/lib/queries/watching";
import { EmptyState } from "@/components/empty-state";
import { Inbox as InboxIcon } from "lucide-react";

const ALL_TAB_CAP = 50;

type MergedItem = {
  id: string;
  source: "notifications" | "approvals" | "requests" | "watching";
  sourceLabel: string;
  title: string;
  subtitle: string | null;
  timestamp: string;
};

// F013 (SB-050, SB-051): the "All" tab — every source's own items merged,
// newest-first, capped at 50, each linking back to its own tab (the
// "source") rather than duplicating each source's own per-kind deep-link
// resolution (that logic already lives in NotificationPanel/ApprovalsQueue/
// TeamRequestInbox and stays there — this tab is a triage overview, not a
// second copy of it).
export async function AllTabContent({
  workspaceSlug,
  workspaceId,
  userId,
  canSeeApprovals,
  canSeeRequests,
}: {
  workspaceSlug: string;
  workspaceId: string;
  userId: string;
  canSeeApprovals: boolean;
  canSeeRequests: boolean;
}) {
  const [notificationsResult, approvalsResult, requestsResult, watchedTasksResult] =
    await Promise.all([
      getNotificationsForWorkspace(workspaceId, 50),
      canSeeApprovals
        ? getOpenApprovalsForWorkspace(workspaceId)
        : Promise.resolve<Awaited<ReturnType<typeof getOpenApprovalsForWorkspace>>>({
            list: [],
          }),
      canSeeRequests
        ? getWorkspaceClientRequests(workspaceId)
        : Promise.resolve<Awaited<ReturnType<typeof getWorkspaceClientRequests>>>({
            list: [],
          }),
      getWatchedTasksForUser(userId),
    ]);

  // F050/F057 (FU-M4-3, FU-M4-10): a real fetch failure on ANY source that
  // feeds the merged "All" tab must never render "Your inbox is empty" —
  // that's indistinguishable from "you have nothing waiting on you".
  // Throw so inbox/error.tsx renders an error affordance instead.
  // Approvals/watching now return the same typed `{ list, error }` shape
  // as notifications/requests (F057), so all four sources are checked the
  // same way here.
  if (notificationsResult.error) {
    throw new Error(notificationsResult.error);
  }
  if (approvalsResult.error) {
    throw new Error(approvalsResult.error);
  }
  if (requestsResult.error) {
    throw new Error(requestsResult.error);
  }
  if (watchedTasksResult.error) {
    throw new Error(watchedTasksResult.error);
  }
  const approvals = approvalsResult.list;
  const requests = requestsResult.list;
  const watchedTasks = watchedTasksResult.list;

  const items: MergedItem[] = [
    ...notificationsResult.list.map((n) => ({
      id: `notification-${n.id}`,
      source: "notifications" as const,
      sourceLabel: "Notification",
      title: n.task?.title ?? "A workspace update",
      subtitle: n.actor?.name ?? null,
      timestamp: n.createdAt,
    })),
    ...approvals.map((a) => ({
      id: `approval-${a.id}`,
      source: "approvals" as const,
      sourceLabel: "Approval",
      title: a.title,
      subtitle: a.projectName,
      timestamp: a.requestedAt,
    })),
    ...requests.map((r) => ({
      id: `request-${r.id}`,
      source: "requests" as const,
      sourceLabel: "Request",
      title: r.title,
      subtitle: r.projectName,
      timestamp: r.createdAt,
    })),
    ...watchedTasks.map((t) => ({
      id: `watching-${t.taskId}`,
      source: "watching" as const,
      sourceLabel: "Watching",
      title: t.taskTitle,
      subtitle: t.projectName,
      timestamp: t.lastActivityAt,
    })),
  ];

  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  const capped = items.slice(0, ALL_TAB_CAP);

  if (capped.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Your inbox is empty"
        description="Notifications, approvals, requests and watched-task activity all show up here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {capped.map((item) => (
        <li key={item.id}>
          <Link
            href={`/w/${workspaceSlug}/inbox?tab=${item.source}`}
            className="flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-accent"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.07em]">
                {item.sourceLabel}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {item.subtitle && (
                <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>
              )}
              <time
                dateTime={item.timestamp}
                className="shrink-0 font-mono text-xs text-muted-foreground"
              >
                {new Date(item.timestamp).toLocaleString()}
              </time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
