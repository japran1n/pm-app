"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Clock,
  LogOut,
  Loader2,
  Menu,
  Settings,
  Archive,
  LayoutTemplate,
  Trash2,
  ListChecks,
  CalendarDays,
  GanttChartSquare,
  Inbox,
  MessageCircle,
} from "lucide-react";

import { useMembership } from "@/components/auth/membership-provider";
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
// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own "Projects"
// section, server-fetched by the layout same as everything else here.
import { ProjectNavList, type SidebarProjectItem } from "@/components/nav/project-nav-list";

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
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

// UX-10: this used to be one flat 12-14 item list — no distinction between
// "used every hour" (My Tasks) and "used once a quarter" (Trash), so the
// eye had to scan the whole thing every time. Grouped into three fixed
// bands by how often each screen gets opened, plus an "Other" band for the
// admin/housekeeping pages at the bottom. Groups are visual only (every
// item still always renders) — several tests (app-sidebar-*-nav.test.tsx)
// assert a given link's presence in the static-rendered HTML regardless of
// grouping, so nothing here is conditionally mounted.
//
// "Search" was dropped from this list entirely: it's already reachable
// from the always-visible header (HeaderSearch, F267) and the `/` shortcut
// (ShortcutProvider), so a third, permanent nav row for it was pure
// duplication.
function navGroups(
  workspaceSlug: string,
  isGuest: boolean,
  canManageWorkspace: boolean,
  hasClient: boolean,
): { label: string | null; items: NavItem[] }[] {
  const work: NavItem[] = [
    { href: `/w/${workspaceSlug}`, label: "Dashboard", icon: LayoutDashboard, exact: true },
    // F230 (AS-435): "My Tasks" placed above "Projects" -- per the
    // feature spec's own "since this is the daily-driver screen" note.
    { href: `/w/${workspaceSlug}/my-tasks`, label: "My Tasks", icon: ListChecks },
    { href: `/w/${workspaceSlug}/projects`, label: "Projects", icon: KanbanSquare },
    // F4 (docs/advanced-chat-plan.md): same primary-nav pattern as the
    // other daily-driver links above -- links to `/chat` (that route's own
    // page.tsx redirects into the caller's first channel on desktop, or
    // renders the channel list itself on mobile; see that file's doc
    // comment).
    { href: `/w/${workspaceSlug}/chat`, label: "Chat", icon: MessageCircle },
  ];

  // F241: Calendar/Timeline are workspace-wide, RLS-scoped views with no
  // guest gate of their own, same as Work above -- visible to everyone.
  const plan: NavItem[] = [
    { href: `/w/${workspaceSlug}/calendar`, label: "Calendar", icon: CalendarDays },
    { href: `/w/${workspaceSlug}/timeline`, label: "Timeline", icon: GanttChartSquare },
    { href: `/w/${workspaceSlug}/time`, label: "Time", icon: Clock },
  ];

  const team: NavItem[] = [
    { href: `/w/${workspaceSlug}/settings/members`, label: "Members", icon: Users },
    // C5: the client-request inbox. Only present when the workspace has a
    // client at all — a permanent empty inbox for the majority of teams
    // who never use the portal is clutter, and it advertises a feature
    // they have not opted into.
    ...(hasClient
      ? [
          {
            href: `/w/${workspaceSlug}/requests`,
            label: "Client requests",
            icon: Inbox,
          },
        ]
      : []),
  ];

  const other: NavItem[] = [
    { href: `/w/${workspaceSlug}/archive`, label: "Archive", icon: Archive },
    // F183: gated to non-guests the same way Members/Archive already are.
    { href: `/w/${workspaceSlug}/templates`, label: "Templates", icon: LayoutTemplate },
    // F188 (AS-343..352): same gating pattern (mirrors F142's archive
    // page).
    { href: `/w/${workspaceSlug}/trash`, label: "Trash", icon: Trash2 },
    ...(canManageWorkspace
      ? [{ href: `/w/${workspaceSlug}/settings`, label: "Settings", icon: Settings, exact: true }]
      : []),
  ];

  const guestExcluded = new Set([
    "Members",
    "Client requests",
    "Archive",
    "Templates",
    "Trash",
  ]);
  const filterGuest = (items: NavItem[]) =>
    isGuest ? items.filter((item) => !guestExcluded.has(item.label)) : items;

  return [
    { label: null, items: work },
    { label: "Plan", items: filterGuest(plan) },
    { label: "Team", items: filterGuest(team) },
    { label: "Other", items: filterGuest(other) },
  ].filter((group) => group.items.length > 0);
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
  projects,
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
  projects: SidebarProjectItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // C5: the client-request nav item is workspace-dependent, so it reads
  // the same server-fetched `hasClient` flag the task sheet's share toggle
  // uses rather than a prop threaded through two more component layers.
  const hasClient = useMembership()?.hasClient ?? false;
  const groups = navGroups(workspaceSlug, isGuest, canManageWorkspace, hasClient);

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
      {/* AS-512: this primary nav is a fixed-height block, not the
          scrolling flex-1 area it used to be -- the Projects section below
          (ProjectNavList) is the one that grows/scrolls now, so a
          workspace with many projects never pushes Dashboard/My
          Tasks/etc. out of view. */}
      {/* BUGFIX: `overflow-y-auto` here was a leftover from before
          AS-512 moved scrolling down to the Projects section below (see
          this block's own comment) — a stale class this refactor never
          removed. Left in place, it doesn't scroll this block (there's
          nothing to overflow, its content is fixed), but a `flex flex-col`
          child with `overflow-y-auto` still creates its own independent
          scroll container, which is what was producing a spurious
          scrollbar in the primary nav. */}
      <nav
        data-tour="sidebar-nav"
        className="flex flex-col gap-3 p-2"
      >
        {groups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
                {group.label}
              </p>
            )}
            {group.items.map(({ href, label, icon: Icon, exact }) => {
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
                    // F265 (AS-518): `max-md:min-h-11` -- this Link is used
                    // both in the always-visible desktop `<aside>` (>= md,
                    // mouse-driven, untouched) AND inside the hamburger-
                    // triggered mobile Sheet (< md, this is the actual
                    // touch-target surface) -- `md` (not `sm`) because
                    // that's the real breakpoint this same component
                    // switches between the two presentations at (see
                    // AppSidebar below: `hidden ... md:flex` / `...
                    // md:hidden`), so a `sm:` check would leave 640-767px
                    // tablet widths (where the mobile Sheet is still what's
                    // shown) under-sized.
                    "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium max-md:min-h-11",
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
          </div>
        ))}
      </nav>

      {/* F262 (AS-509, AS-511, AS-512, AS-513): visible to every role
          including guests -- a guest's own project list is already scoped
          server-side by the RLS-backed query the layout uses (F134/F132),
          same "hide nothing, the query already filtered it" convention
          Dashboard/My Tasks/Calendar above follow (unlike Members/Archive/
          Templates/Trash, which are role-gated because their *pages*, not
          just their data, are off-limits to a guest). `flex-1 min-h-0`
          here (not on the primary nav above) is what makes this the ONE
          section that grows to fill remaining space and scrolls
          internally. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectNavList
          workspaceSlug={workspaceSlug}
          workspaceId={currentWorkspaceId}
          projects={projects}
          onNavigate={onNavigate}
        />
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
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
            // F265 (AS-518): same `max-md:min-h-11` reasoning as the
            // primary nav items above -- this Link is shared between the
            // desktop `<aside>` and the mobile hamburger Sheet.
            "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors max-md:min-h-11",
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
        {/* F256 (AS-499): plain `<form action={signOut}>` had no pending
            state, so a fast double-click fired signOut() twice — harmless
            given signOut()'s own idempotent redirect, but not the
            "control shows pending + can't be double-submitted" contract
            every other mutating control in this app follows. Same
            useTransition + disabled-while-pending shape as
            RemoveMemberButton/RevokeInviteButton rather than a bare
            form action. */}
        <SignOutButton />
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
  projects = [],
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
  /** F262 (AS-509, AS-511, AS-512, AS-513): the workspace's visible
   * projects (already RLS/guest-scoped by the layout's query), rendered
   * as the sidebar's own "Projects" section. Default `[]` keeps every
   * existing caller/test that predates this feature rendering the
   * section's empty state instead of crashing. */
  projects?: SidebarProjectItem[];
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop: pinned, always-visible sidebar (this app is desktop-first).
          `sticky top-0` rather than `fixed`: the aside stays a real flex
          item, so it keeps reserving its 240px column and `main` needs no
          compensating margin — a `fixed` sidebar would drop out of flow and
          every page's content would slide underneath it.
          It was already `h-svh`, which sized it to the viewport but did not
          pin it: the page (not `main`) is the scroll container, so on any
          view taller than the viewport the whole column scrolled out of
          sight along with the content. */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col self-start border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarContent
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          currentUser={currentUser}
          isGuest={isGuest}
          canManageWorkspace={canManageWorkspace}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
          projects={projects}
        />
      </aside>

      {/* Mobile: sidebar content lives behind a hamburger-triggered sheet so
          narrow viewports aren't broken by a 240px fixed column eating the
          screen. */}
      <div className="flex h-12 items-center justify-between border-b bg-sidebar px-2 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              // F265 (AS-518): `size="icon"` alone is `size-8` (32px) --
              // below the 44px touch-target minimum. `max-sm:size-11`
              // bumps it to 44px on phone widths without changing the
              // desktop-hidden (this whole bar is `md:hidden`) rendering;
              // `sm:size-11` is intentionally omitted so 640-767px
              // tablet widths (where this trigger is still the one
              // shown, per the `md:hidden` wrapper) also get the larger
              // target -- using `max-md:size-11` instead of `max-sm:` for
              // the same reason the nav Links above use `max-md:`.
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                className="max-md:size-11"
              >
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
              projects={projects}
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

// F256 (AS-497/AS-498/AS-499): sign-out as its own tiny client control so
// it gets the same useTransition + disabled-while-pending shape as every
// other mutating control in this app (RemoveMemberButton,
// RevokeInviteButton, etc.) instead of a bare `<form action={signOut}>`
// with no pending affordance. `signOut()` always redirects (never
// resolves to an `{ok:false}` result — see lib/actions/auth.ts), so there
// is no rollback/toast branch to add: the only genuine gap here was the
// missing pending-disabled state that guards against a double-submit.
// Exported (not just used internally) so tests/unit/optimistic-pending-
// audit.test.tsx (F256, AS-497/AS-499) can render it directly without
// pulling in the whole AppSidebar shell.
export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={handleClick}
      className="w-full justify-start gap-2.5 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="size-4" aria-hidden="true" />
      )}
      Sign out
    </Button>
  );
}
