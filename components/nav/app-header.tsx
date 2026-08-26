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

export function AppHeader({
  workspaceId,
  workspaceSlug,
  workspaceName,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-background px-4">
      <div className="min-w-0 flex-1">
        <AppBreadcrumb
          workspaceSlug={workspaceSlug}
          workspaceName={workspaceName}
        />
      </div>
      <HeaderSearch workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
    </header>
  );
}
