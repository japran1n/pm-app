"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Search,
  Users,
  Clock,
  LogOut,
  Menu,
  Settings,
  Archive,
  LayoutTemplate,
  Trash2,
  ListChecks,
  CalendarDays,
  GanttChartSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/actions/auth";
import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
// F208 (AS-379): the notification bell — mounted here since this app has
// no real top bar yet (per this feature's own Notes; a future F267 header
// may relocate it), so the sidebar's workspace-switcher row is the only
// reachable, always-visible chrome to put it in today.
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationListItem } from "@/lib/queries/notifications";

// Persistent left nav shell wrapping every /w/[workspaceSlug]/* page (see
// app/(workspace)/w/[workspaceSlug]/layout.tsx). Client Component: needs
// usePathname() for active-route highlighting. The workspace data itself
// is still server-fetched by the layout and passed down as props, keeping
// this component's own state to just "which link is active" (desktop) /
// "is the mobile sheet open" (mobile).
// F134 (AS-222): a guest never sees the "Members" nav item — this is the
// hide-the-control half of AS-222 (the members page itself independently
// denies direct navigation, see app/(workspace)/w/[workspaceSlug]/settings/
// members/page.tsx's own canViewMembersList guard; this hides the link so
// a guest isn't shown a control that would only bounce them back).
// F136 (AS-239): a "Settings" nav item, only shown to owner/admin
// (`canManageWorkspace`, threaded down from the layout's own
// `canManageProject` check) — a member/viewer sees no entry point to
// `/w/[workspaceSlug]/settings` from the sidebar, matching AS-239's
// "reachable from the sidebar for owners and admins" wording. This is a
// UI-only convenience gate; the settings page itself independently
// denies guests (see that page's own `role === "guest"` redirect) and
// `renameWorkspace`/`deleteWorkspace` re-check server-side (AS-230
// convention), so hiding this link is not the actual security boundary.
//
// F142: an "Archive" nav item, gated to non-guests the same way "Members"
// already is — a guest never sees an entry point to
// `/w/[workspaceSlug]/archive` from the sidebar. This is a UI-only
// convenience gate, same caveat as above; the archive page itself
// independently redirects a guest who navigates there directly (see that
// page's own `role === "guest"` redirect).
function navItems(
  workspaceSlug: string,
  isGuest: boolean,
  canManageWorkspace: boolean,
) {
  const items = [
    { href: `/w/${workspaceSlug}`, label: "Dashboard", icon: LayoutDashboard, exact: true },
    // F230 (AS-435): "My Tasks" placed above "Projects" -- per the
    // feature spec's own "since this is the daily-driver screen" note --
    // visible to everyone (including guests), same as Dashboard/Projects.
    { href: `/w/${workspaceSlug}/my-tasks`, label: "My Tasks", icon: ListChecks },
    { href: `/w/${workspaceSlug}/projects`, label: "Projects", icon: KanbanSquare },
    // F241: "Calendar" and "Timeline" nav items -- both pages are
    // workspace-wide, RLS-scoped-query views with no guest gate of their
    // own (see their own page.tsx doc comments -- they mirror My Tasks'
    // structure, not Members/Archive/Templates/Trash's guest-redirect
    // pattern), so they're visible to everyone including guests, same as
    // My Tasks/Projects/Search above. Placed after Projects/before Search
    // as other workspace-wide, non-project-scoped views.
    { href: `/w/${workspaceSlug}/calendar`, label: "Calendar", icon: CalendarDays },
    { href: `/w/${workspaceSlug}/timeline`, label: "Timeline", icon: GanttChartSquare },
    { href: `/w/${workspaceSlug}/search`, label: "Search", icon: Search },
    { href: `/w/${workspaceSlug}/time`, label: "Time", icon: Clock },
    { href: `/w/${workspaceSlug}/settings/members`, label: "Members", icon: Users },
    { href: `/w/${workspaceSlug}/archive`, label: "Archive", icon: Archive },
    // F183: "Templates" nav item, gated to non-guests the same way
    // "Members"/"Archive" already are — a guest never sees an entry point
    // to /w/[workspaceSlug]/templates from the sidebar; that page
    // independently redirects a guest who navigates there directly.
    { href: `/w/${workspaceSlug}/templates`, label: "Templates", icon: LayoutTemplate },
    // F188 (AS-343..352): "Trash" nav item, gated to non-guests the same
    // way "Members"/"Archive"/"Templates" already are — a guest never
    // sees an entry point to /w/[workspaceSlug]/trash from the sidebar;
    // that page independently redirects a guest who navigates there
    // directly (mirrors F142's archive page pattern exactly).
    { href: `/w/${workspaceSlug}/trash`, label: "Trash", icon: Trash2 },
    ...(canManageWorkspace
      ? [{ href: `/w/${workspaceSlug}/settings`, label: "Settings", icon: Settings, exact: true }]
      : []),
  ];

  return isGuest
    ? items.filter(
        (item) =>
          item.label !== "Members" &&
          item.label !== "Archive" &&
          item.label !== "Templates" &&
          item.label !== "Trash",
      )
    : items;
}

function SidebarContent({
  workspaceSlug,
  workspaces,
  currentWorkspaceId,
  currentUser,
  isGuest,
  canManageWorkspace,
  initialNotifications,
  initialUnreadCount,
  onNavigate,
}: {
  workspaceSlug: string;
  workspaces: SwitcherWorkspace[];
  currentWorkspaceId: string;
  currentUser: UserAvatarPerson;
  isGuest: boolean;
  canManageWorkspace: boolean;
  initialNotifications: NotificationListItem[];
  initialUnreadCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navItems(workspaceSlug, isGuest, canManageWorkspace);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-1 border-b px-3">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
          />
        </div>
        <NotificationBell
          workspaceSlug={workspaceSlug}
          workspaceId={currentWorkspaceId}
          currentUserId={currentUser.id}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
        />
      </div>

      {/* F253 (AS-491): anchor target for the onboarding tour's "sidebar"
          step. Always rendered regardless of role — the skip rule in
          components/onboarding/tour.tsx only needs a target to be ABSENT
          when it truly shouldn't apply (e.g. the "New task" step for a
          viewer); this nav exists for every signed-in member. */}
      <nav
        data-tour="sidebar-nav"
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      >
        {items.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 border-t p-2">
        {/* F273 (AS-202): the only in-app entry point to the profile
            settings page (F123) — without this a user has no way to set a
            display name except by typing the URL by hand. Reuses
            UserAvatar/personLabel (F122) rather than a new name/initials
            implementation, per this feature's inherited clarification. */}
        <Link
          href={`/w/${workspaceSlug}/settings/profile`}
          onClick={onNavigate}
          aria-current={
            pathname === `/w/${workspaceSlug}/settings/profile`
              ? "page"
              : undefined
          }
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
            pathname === `/w/${workspaceSlug}/settings/profile`
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <UserAvatar person={currentUser} size="sm" />
          <span className="min-w-0 flex-1 truncate">
            {personLabel(currentUser)}
          </span>
        </Link>
        {/* F125 (AS-211): theme toggle, next to sign-out per the feature
            spec's Files list. */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium text-sidebar-foreground/70">
            Theme
          </span>
          <ThemeToggle />
        </div>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2.5 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

export function AppSidebar({
  workspaceSlug,
  workspaces,
  currentWorkspaceId,
  currentUser,
  isGuest = false,
  canManageWorkspace = false,
  initialNotifications = [],
  initialUnreadCount = 0,
}: {
  workspaceSlug: string;
  workspaces: SwitcherWorkspace[];
  currentWorkspaceId: string;
  currentUser: UserAvatarPerson;
  isGuest?: boolean;
  canManageWorkspace?: boolean;
  /** F208 (AS-379): the bell's initial data, server-fetched by the
   * layout. Default `[]`/`0` keeps every existing caller/test that
   * doesn't pass these (they predate this feature) rendering the bell in
   * its empty state instead of crashing. */
  initialNotifications?: NotificationListItem[];
  initialUnreadCount?: number;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop: fixed, always-visible sidebar (this app is desktop-first). */}
      <aside className="hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarContent
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          currentUser={currentUser}
          isGuest={isGuest}
          canManageWorkspace={canManageWorkspace}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
        />
      </aside>

      {/* Mobile: sidebar content lives behind a hamburger-triggered sheet so
          narrow viewports aren't broken by a 240px fixed column eating the
          screen. */}
      <div className="flex h-12 items-center justify-between border-b bg-sidebar px-2 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            }
          />
          <SheetContent side="left" className="w-64 p-0">
            <SidebarContent
              workspaceSlug={workspaceSlug}
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
              currentUser={currentUser}
              isGuest={isGuest}
              canManageWorkspace={canManageWorkspace}
              initialNotifications={initialNotifications}
              initialUnreadCount={initialUnreadCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        {/* F208: the bell also needs to be reachable on mobile, where the
            desktop sidebar (and its own bell) is hidden entirely. */}
        <NotificationBell
          workspaceSlug={workspaceSlug}
          workspaceId={currentWorkspaceId}
          currentUserId={currentUser.id}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
        />
      </div>
    </>
  );
}
