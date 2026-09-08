import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { NotificationPanel } from "@/components/notifications/notification-panel";

// F208: the full notifications page — the bell popover's "View all
// notifications" link target, for older items beyond the popover's
// capped list. Server Component: fetches this workspace's notifications
// (a wider limit than the popover's default) and passes them down to the
// same <NotificationPanel> the bell uses, so mark-read/mark-all behaviour
// (AS-386, AS-387) is defined in exactly one place, not duplicated for
// this page.
//
// Access: every active member (including guests) sees their own
// notifications — unlike Archive/Members/Templates/Trash, this is a
// strictly self-scoped inbox (RLS: user_id = auth.uid()), not a
// workspace-broad admin-adjacent view, so there is no guest gate here.
const PAGE_LIMIT = 100;

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard one level up already
  // redirects away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  const { list, unreadCount } = await getNotificationsForWorkspace(
    workspace.id,
    PAGE_LIMIT,
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="title-1 font-semibold">Notifications</h1>
      <NotificationPanel
        workspaceSlug={workspaceSlug}
        workspaceId={workspace.id}
        initialNotifications={list}
        initialUnreadCount={unreadCount}
        emptyStateClassName="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center"
      />
    </div>
  );
}
