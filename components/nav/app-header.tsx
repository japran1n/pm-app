// F267 (AS-519): a thin, always-present header rendered above every
// workspace page's own content, containing the header search input.
//
// UX-09: this used to be *only* the search box — no breadcrumb, no page
// title, no primary action. On a page like
// `/w/acme/projects/8f3c…/board` there was nothing on screen naming the
// project or the view, so getting back a level meant guessing. The
// breadcrumb (components/nav/app-breadcrumb.tsx) fixes the "where am I"
// half of that; the notification bell and user menu stay where F267's
// original AUTONOMOUS_DECISION put them (sidebar) — moving those is still
// out of scope here, no assertion drives it.
//
// Server Component: no interactivity of its own, just passes the
// workspace identifiers down to the Client Components (HeaderSearch,
// AppBreadcrumb) that actually need them.

import { HeaderSearch } from "@/components/nav/header-search";
import { AppBreadcrumb } from "@/components/nav/app-breadcrumb";
import { GlobalTimeTracker } from "@/components/time/global-time-tracker";
import { WhatsNewPanel } from "@/components/whats-new/whats-new-panel";
import { createClient } from "@/lib/supabase/server";
import { getActiveTimer, getMyRecentTimeEntries } from "@/lib/queries/time-entries";

export async function AppHeader({
  workspaceId,
  workspaceSlug,
  workspaceName,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}) {
  // Global "Track Time" widget: fetched once here on the header's initial
  // Server Component render (same convention as the sidebar's own
  // server-fetched props one level up) so the popover opens with real data
  // immediately, rather than a client-side loading flash. A signed-out
  // caller never reaches this layout (workspace layout guard), but the
  // lookups are defensive against a null user regardless, same as every
  // other query in lib/queries/time-entries.ts.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [activeTimer, recentEntries] = user
    ? await Promise.all([
        getActiveTimer(),
        getMyRecentTimeEntries(user.id),
      ])
    : [null, []];

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-4">
      <div className="min-w-0 flex-1">
        <AppBreadcrumb
          workspaceSlug={workspaceSlug}
          workspaceName={workspaceName}
        />
      </div>
      <HeaderSearch workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      {/* Feature request: static in-app "what's new" panel -- placed next
          to search/time-tracker in this always-visible header, same
          reachability convention as those two. */}
      <WhatsNewPanel />
      <GlobalTimeTracker
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        initialActiveTimer={
          activeTimer
            ? {
                id: activeTimer.id,
                taskId: activeTimer.taskId,
                taskTitle: activeTimer.task.title,
                startedAt: activeTimer.startedAt,
              }
            : null
        }
        initialRecentEntries={recentEntries}
      />
    </header>
  );
}
