"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Clock,
  LogOut,
  Loader2,
  Menu,
  ListChecks,
  CalendarDays,
  Inbox,
  MessageCircle,
  CheckSquare,
  Code2,
  Network,
  FileCode2,
  ChevronDown,
  Search,
} from "lucide-react";

import { useMembership } from "@/components/auth/membership-provider";
import { cn } from "@/lib/utils";
import {
  COMMAND_PALETTE_OPEN_EVENT,
  isMacPlatform,
} from "@/lib/hooks/use-shortcut";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { NewMenu } from "@/components/nav/new-menu";
import { toast } from "sonner";

import { signOut } from "@/lib/actions/auth";
import type { UserAvatarPerson } from "@/components/user-avatar";
import { AccountMenu } from "@/components/nav/account-menu";
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
// F134 (AS-222) / F001 (SB-010, SB-011): a guest never sees the "Team" nav
// item (which is now the sole sidebar entry point toward member-related
// pages) — this is the hide-the-control half of AS-222 (the members
// settings page itself independently denies direct navigation, see
// app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx's own
// canViewMembersList guard; this hides the link so a guest isn't shown a
// control that would only bounce them back).
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
// F010: an "Approvals" nav item, gated to non-guests the same way
// Members/Archive already are (a guest has no business chasing client
// decisions), with a count badge for OPEN (pending) approvals only — a
// withdrawn/decided row is excluded at the query layer
// (getOpenApprovalsForWorkspace's own `.eq("state", "pending")`), so
// "double-counting withdrawn rows" is structurally impossible here, not
// just avoided by convention.
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  count?: number;
  // F016 (AS-017): when the layout streams this item's badge in via its
  // own async server component (approvals/requests/chat-unread), the
  // fully-formed node (or `null`) is threaded through here instead of a
  // plain `count`, so the render loop below never needs to know whether a
  // given badge came from a synchronous number or a streamed figure.
  badge?: React.ReactNode;
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
  approvalsCount: number,
  requestsCount: number,
  chatUnreadCount: number,
  // F016 (AS-017): optional streamed badge nodes -- when provided (the
  // real layout always provides these now, each resolved inside its own
  // `<Suspense>`), they take priority over the plain counts above so the
  // exact same markup renders whether the value arrived synchronously (as
  // in every existing test in this file) or via a streamed figure.
  approvalsBadge?: React.ReactNode,
  requestsBadge?: React.ReactNode,
  chatUnreadBadge?: React.ReactNode,
): { label: string | null; items: NavItem[] }[] {
  const countBadge = (count: number) =>
    typeof count === "number" && count > 0 ? (
      <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
        {count}
      </Badge>
    ) : null;
  const work: NavItem[] = [
    // F013 (SB-057): "Watching" is no longer its own sidebar item -- it is
    // now one of the Inbox tabs (`/w/<slug>/inbox?tab=watching`,
    // components/inbox/inbox-tab-nav.tsx).
    // F014 (SB-053, SB-054, SB-055): "Inbox" itself -- one badge summing
    // unread notifications + pending approvals + open client requests
    // (lib/inbox/inbox-badge-count.ts), replacing the removed notification
    // bell's own unread badge.
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
    // Feature request (sidebar unread badges): same count-badge treatment
    // as "Approvals"/"Client requests" below -- the sum of every channel's
    // own unread count (lib/queries/chat.ts's getWorkspaceChatUnreadTotal,
    // itself a thin sum over getWorkspaceChannels' per-channel
    // unreadCount, which chat-nav-list.tsx already treats as the
    // source of truth for "unread" there).
    { href: `/w/${workspaceSlug}/chat`, label: "Chat", icon: MessageCircle, badge: chatUnreadBadge ?? countBadge(chatUnreadCount) },
  ];

  // F010 (TH-001, TH-002, TH-003, TH-005, TH-007, TH-012): dedicated "Tools"
  // band, positioned between "Team" and "Other" below. The HTML→Webflow
  // converter (formerly "Webflow" in the top-level `work` band, F003/F002)
  // now lives here under its clearer "HTML → Webflow" label -- same route
  // (`/w/<slug>/tools/webflow`), not gated on role/guest/hasClient (TH-012:
  // always renders for every workspace regardless of whether it has a
  // client, same "no per-workspace conditional" convention this item
  // already followed in its old home).
  const tools: NavItem[] = [
    { href: `/w/${workspaceSlug}/tools/webflow`, label: "HTML → Webflow", icon: Code2 },
    // F011 (TH-004, TH-006, TH-009, TH-010, TH-011): a second Tools-band
    // item, below "HTML → Webflow" per this feature's own clarified
    // implementation -- same no-gate, prefix-matched active-state
    // convention as its sibling above (no `exact: true`), same route shape
    // (`/w/<slug>/tools/code-editor`).
    { href: `/w/${workspaceSlug}/tools/code-editor`, label: "Webflow Code Editor", icon: FileCode2 },
    { href: `/w/${workspaceSlug}/tools/sitemap`, label: "Sitemap Builder", icon: Network },
  ];

  // F241: Calendar is a workspace-wide, RLS-scoped view with no guest gate
  // of its own, same as Work above -- visible to everyone.
  // Timeline was removed entirely (dedicated feature request) -- its own
  // nav item, route, and dedicated components/queries no longer exist.
  const plan: NavItem[] = [
    { href: `/w/${workspaceSlug}/calendar`, label: "Planner", icon: CalendarDays },
    { href: `/w/${workspaceSlug}/time`, label: "Time", icon: Clock },
  ];

  const team: NavItem[] = [
    // Team directory: a member profile page per person (avatar/name/role,
    // their projects, assigned tasks, and a link to their time report).
    // F001 (SB-010): the separate "Members" nav item (admin-facing
    // invite/role-management table) was merged into this single "Team"
    // entry point — the members table itself is still reachable from the
    // Settings page's own "Members" tab (SB-011), not duplicated here.
    { href: `/w/${workspaceSlug}/team`, label: "Team", icon: Users },
    // C5: the client-request inbox. Only present when the workspace has a
    // client at all — a permanent empty inbox for the majority of teams
    // who never use the portal is clutter, and it advertises a feature
    // they have not opted into.
    ...(hasClient
      ? [
          {
            href: `/w/${workspaceSlug}/inbox?tab=requests`,
            label: "Client requests",
            icon: Inbox,
            // F083: a change request is at least as time-sensitive as a
            // pending approval — same count-badge treatment as
            // "Approvals" directly below, threaded the same way.
            badge: requestsBadge ?? countBadge(requestsCount),
          },
          // F010: same "only present when the workspace has a client at
          // all" gating as Client requests above — an approval queue is
          // meaningless clutter for a workspace with no client to ever
          // decide one.
          {
            href: `/w/${workspaceSlug}/inbox?tab=approvals`,
            label: "Approvals",
            icon: CheckSquare,
            badge: approvalsBadge ?? countBadge(approvalsCount),
          },
        ]
      : []),
    // F004 (SB-019): "Preview as client" moved into AccountMenu (same
    // hasClient && canManageWorkspace condition as before; see
    // components/nav/account-menu.tsx).
  ];

  // F003 (SB-016, SB-017): the "Other" group (Archive, Templates, Trash,
  // "How this works", and a duplicate "Settings") is dissolved entirely --
  // Archive/Templates/Trash/Help now live in AccountMenu (see that
  // component's own doc comment for gating); Settings was already reachable
  // from AccountMenu since F002, so the sidebar's own copy is just removed,
  // not relocated. Watching moved up into the primary "Work" band above
  // (temporary until F013).

  const guestExcluded = new Set([
    "Team",
    "Client requests",
    "Approvals",
  ]);
  const filterGuest = (items: NavItem[]) =>
    isGuest ? items.filter((item) => !guestExcluded.has(item.label)) : items;

  return [
    { label: null, items: work },
    { label: "Plan", items: filterGuest(plan) },
    { label: "Team", items: filterGuest(team) },
    // F010 (TH-002, TH-012): "Tools" sits between "Team" and (formerly)
    // "Other" per this feature's own Draft scope, and is NOT run through
    // `filterGuest` -- it always renders for every role/workspace
    // (TH-012). F003 (SB-016): "Other" itself is gone -- see the doc
    // comment above `guestExcluded`.
    { label: "Tools", items: tools },
  ].filter((group) => group.items.length > 0);
}

function SidebarContent({
  workspaceSlug,
  workspaces,
  currentWorkspaceId,
  currentUser,
  isGuest,
  canManageWorkspace,
  // F014: kept as a back-compat prop (never read here any more, see this
  // destructure's own doc comment below) -- the bell that used to consume
  // these is gone.
  initialNotifications: _initialNotifications,
  initialUnreadCount: _initialUnreadCount,
  projects,
  approvalsCount = 0,
  requestsCount = 0,
  chatUnreadCount = 0,
  approvalsBadge,
  requestsBadge,
  chatUnreadBadge,
  inboxBadge,
  workspaceSwitcherSlot,
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
  approvalsCount?: number;
  /** F083: open (submitted/in_review) client-request count for the
   * "Client requests" nav item's badge — server-fetched by the layout via
   * `getOpenClientRequestCountForWorkspace(...)`. Default `0` keeps every
   * existing caller/test rendering the item with no badge instead of
   * crashing, same convention as `approvalsCount` above. */
  requestsCount?: number;
  /** Feature request (sidebar unread badges): total unread chat messages
   * across every channel the caller belongs to, for the "Chat" nav item's
   * badge — server-fetched by the layout via
   * `getWorkspaceChatUnreadTotal(...)`. Default `0` keeps every existing
   * caller/test rendering the item with no badge instead of crashing,
   * same convention as `approvalsCount`/`requestsCount` above. */
  chatUnreadCount?: number;
  /** F016 (AS-017): when provided, the layout's own streamed figure
   * (`components/nav/figures/*-badge-figure.tsx`, each resolved inside its
   * own `<Suspense fallback={null}>`) — takes priority over the plain
   * `*Count` numbers above, which stay purely as the back-compat fallback
   * every existing test in this file still exercises directly. */
  approvalsBadge?: React.ReactNode;
  requestsBadge?: React.ReactNode;
  chatUnreadBadge?: React.ReactNode;
  /** F014 (SB-053, SB-054, SB-055): the "Inbox" nav item's own aggregate
   * badge (unread notifications + pending approvals + open client
   * requests), streamed in by the layout via
   * `components/nav/figures/inbox-badge-figure.tsx` inside its own
   * `<Suspense fallback={null}>`. This REPLACES the removed notification
   * bell's own unread badge -- see that figure's own header comment. */
  inboxBadge?: React.ReactNode;
  /** F016 (AS-017): the workspace switcher, streamed in by the layout via
   * `components/nav/figures/workspace-switcher-figure.tsx` inside its own
   * `<Suspense fallback={null}>`. When omitted, falls back to rendering
   * `<WorkspaceSwitcher>` directly from the `workspaces` prop (unchanged
   * back-compat path for existing tests). */
  workspaceSwitcherSlot?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams?.get("tab") ?? null;
  const router = useRouter();
  // F008 (SB-031): platform-aware shortcut hint. Resolved after mount so
  // server and first client render agree (Ctrl K), then upgraded to the
  // Mac glyph.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration platform read
    setIsMac(isMacPlatform());
  }, []);
  const openSearch = () => {
    onNavigate?.();
    // Ask the mounted CommandPalette to open (it owns the only Cmd+K
    // listener). If none answers, fall back to the search page.
    const detail = { handled: false };
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, { detail }));
    if (!detail.handled) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[AppSidebar] No CommandPalette acknowledged the open request; falling back to the /search page. Check that <CommandPalette> is mounted and listens for COMMAND_PALETTE_OPEN_EVENT.",
        );
      }
      router.push(`/w/${workspaceSlug}/search`);
    }
  };
  // C5: the client-request nav item is workspace-dependent, so it reads
  // the same server-fetched `hasClient` flag the task sheet's share toggle
  // uses rather than a prop threaded through two more component layers.
  const hasClient = useMembership()?.hasClient ?? false;
  // F005 (SB-020, SB-021): Tools group collapse state, persisted in
  // localStorage. Default expanded; storage access is try/catch-guarded so a
  // throwing localStorage never breaks render.
  const [toolsOpen, setToolsOpen] = useState(true);
  const toolsPanelId = useId();
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration read of persisted UI state
      if (window.localStorage.getItem("sidebar:tools-open") === "false") setToolsOpen(false);
    } catch {
      // ignore: stay expanded
    }
  }, []);
  const toggleTools = () => {
    setToolsOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("sidebar:tools-open", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const groups = navGroups(
    workspaceSlug,
    isGuest,
    canManageWorkspace,
    hasClient,
    approvalsCount,
    requestsCount,
    chatUnreadCount,
    approvalsBadge,
    requestsBadge,
    chatUnreadBadge,
  );

  // F060 (SB-056): every `?tab=` value a sibling item on the same path
  // explicitly claims via its own `hrefTab` (e.g. "Client requests" claims
  // `requests`, "Approvals" claims `approvals`) -- computed once across all
  // groups/items so the tab-less item below (Inbox) can tell, for any given
  // `?tab=`, whether some OTHER item already owns it.
  const claimedTabsByPath = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const item of group.items) {
      const [itemPath, itemQuery] = item.href.split("?");
      const itemTab = itemQuery
        ? new URLSearchParams(itemQuery).get("tab")
        : null;
      if (!itemTab) continue;
      if (!claimedTabsByPath.has(itemPath)) claimedTabsByPath.set(itemPath, new Set());
      claimedTabsByPath.get(itemPath)!.add(itemTab);
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowFade(el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFade();
    el.addEventListener("scroll", updateFade, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateFade) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    return () => {
      el.removeEventListener("scroll", updateFade);
      ro?.disconnect();
    };
  }, [updateFade]);

  return (
    <div className="flex h-full flex-col">
      {/* F038 (SB-030): the switcher owns the whole header row (full sidebar
          inner width). The bell used to share this row and stole ~46px, which
          forced a 40-char name to clip; it now sits beside Search below. */}
      <div className="flex min-h-12 items-center border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          {workspaceSwitcherSlot ?? (
            <WorkspaceSwitcher
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 pt-3">
        <NewMenu
          workspaceSlug={workspaceSlug}
          workspaceId={currentWorkspaceId}
          isGuest={isGuest}
          onNavigate={onNavigate}
        />
        {/* F014: the notification bell that used to sit here is gone --
            its unread count is now the "Inbox" nav item's own badge below,
            and its realtime side effects moved to
            components/notifications/notifications-realtime-effects.tsx
            (mounted once by the workspace layout, not here). */}
        <button
          type="button"
          onClick={openSearch}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border bg-transparent px-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:border-[var(--border-control-hover)] hover:bg-muted/50 hover:text-foreground"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-mono text-xs text-muted-foreground">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </div>

      {/* F253 (AS-491): anchor target for the onboarding tour's "sidebar"
          step. Always rendered regardless of role — the skip rule in
          components/onboarding/tour.tsx only needs a target to be ABSENT
          when it truly shouldn't apply (e.g. the "New task" step for a
          viewer); this nav exists for every signed-in member. */}
      {/* AS-512: this primary nav is meant to be a fixed-height block, not
          a scrolling flex-1 area -- the Projects section below
          (ProjectNavList) is the one that grows/scrolls under normal
          conditions, so a workspace with many projects never pushes
          Dashboard/My Tasks/etc. out of view. */}
      {/* F119 (AS-069): wrapping {nav, Projects} together in their own
          `flex min-h-0 flex-1 flex-col overflow-y-auto` region (rather
          than letting `nav` sit as a bare sibling of the header/footer)
          is what gives this whole middle area a real last-resort scroll
          fallback for a workspace with ~12 primary-nav items on a very
          short viewport: `nav` below keeps `shrink-0` (it should never be
          compressed -- AS-512's intent), and the Projects wrapper keeps
          its own `flex-1 min-h-0` + internal `overflow-y-auto`
          (project-nav-list.tsx) as the normal, independent scroll
          container. Under ordinary viewport heights this outer
          `overflow-y-auto` is a no-op (content already fits, Projects
          absorbs the squeeze down to 0 first since it's the only
          `flex-1` item) -- it only actually engages, scrolling `nav`
          itself, in the true edge case where even a fully-collapsed
          (0-height) Projects section still doesn't leave enough room for
          every primary nav item. That is the "last resort" this
          component's own spec calls for: normally Projects is the only
          section that scrolls; nav only ever joins in when nothing else
          is left to give up. This does NOT reintroduce the BUGFIX'd
          spurious-scrollbar issue from before AS-512: that bug was a
          `overflow-y-auto` on an element with no bounded ancestor and
          nothing to overflow, so it fired unconditionally; this
          `overflow-y-auto` only ever shows a scrollbar when its content
          genuinely exceeds its allotted (bounded via `min-h-0` +
          `flex-1` up the chain to the sidebar's own `h-svh`) height. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="sidebar-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <nav
          data-tour="sidebar-nav"
          className="flex shrink-0 flex-col gap-2 p-2"
        >
          {groups.map((group, groupIndex) => (
            <div key={group.label ?? `group-${groupIndex}`} className="flex flex-col gap-0.5">
              {group.label === "Tools" ? (
                <p className="mb-1 mt-2 px-2 text-xs text-muted-foreground uppercase tracking-wide">
                  <button
                    type="button"
                    onClick={toggleTools}
                    aria-expanded={toolsOpen}
                    aria-controls={group.items.map((_, i) => `${toolsPanelId}-${i}`).join(" ")}
                    className="flex w-full items-center gap-1 text-left uppercase tracking-wide hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn("size-3 shrink-0 transition-transform", toolsOpen ? "rotate-0" : "-rotate-90")}
                      aria-hidden="true"
                    />
                    {group.label}
                  </button>
                </p>
              ) : (
                group.label && (
                  <p className="px-2 mb-1 mt-2 text-xs text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </p>
                )
              )}
              {group.items.map(({ href, label, icon: Icon, exact, badge }, itemIndex) => {
                // FU-M4-5 (M4 scrutiny): some nav items now carry a
                // `?tab=` search param in their href (e.g. "Approvals" ->
                // `/w/<slug>/inbox?tab=approvals`, "Client requests" ->
                // `/w/<slug>/inbox?tab=requests`) rather than a distinct
                // route. A plain `pathname === href` comparison never
                // matches those (pathname never contains the query
                // string), so they could never highlight or receive
                // aria-current. Split the href's own pathname portion from
                // its `tab` param (if any) and require both the pathname
                // AND the current `?tab=` search param to match.
                const [hrefPath, hrefQuery] = href.split("?");
                const hrefTab = hrefQuery
                  ? new URLSearchParams(hrefQuery).get("tab")
                  : null;
                const pathMatches = exact
                  ? pathname === hrefPath
                  : pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
                // FU-M4-11 (M4 scrutiny attempt 2): a tab-less item (e.g.
                // Inbox, no `?tab=` in its own href) matched on `pathMatches`
                // alone, so it stayed active even when the URL's `?tab=`
                // pointed at a sibling item's own tab (e.g. `?tab=approvals`
                // also lit up "Inbox" since both share the `/inbox` path).
                // F060 (SB-056): that fix over-corrected for `?tab=`
                // values that have NO dedicated sidebar item at all
                // (`notifications`, `watching` -- only `all`/`approvals`/
                // `requests` have one). For those, the old "only active
                // when no currentTab" rule left every item inactive. A
                // tab-less item's real rule is "active whenever no OTHER
                // item on the same path claims the current tab" -- which
                // still excludes it exactly when a sibling (Approvals/
                // Client requests) owns the current tab, but now also
                // covers `notifications`/`watching`, which no sibling
                // claims. Tab-bearing items are unaffected: they still
                // require an exact tab match via `currentTab === hrefTab`.
                const isActive = hrefTab
                  ? pathMatches && currentTab === hrefTab
                  : pathMatches &&
                    (!currentTab || !claimedTabsByPath.get(hrefPath)?.has(currentTab));

                return (
                  <Link
                    key={href}
                    href={href}
                    id={group.label === "Tools" ? `${toolsPanelId}-${itemIndex}` : undefined}
                    hidden={group.label === "Tools" && !toolsOpen}
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
                      "flex items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-sm md:h-8 md:py-0 max-md:min-h-11",
                      isActive
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {/* AS-127: icon stays text-muted-foreground even when active (lower contrast than the active label's text-foreground) -- deliberate visual hierarchy, and text-tertiary-foreground is banned here since this icon is operative, not decorative. */}
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {/* F010: same small-numeric-badge shape as the bell's own
                        unread count (components/notifications/notification-bell.tsx)
                        — 0/undefined renders nothing, so a settled workspace's
                        nav item looks exactly like any other plain link. */}
                    {badge}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* F262 (AS-509, AS-511, AS-512, AS-513): visible to every role
            including guests -- a guest's own project list is already
            scoped server-side by the RLS-backed query the layout uses
            (F134/F132), same "hide nothing, the query already filtered
            it" convention Dashboard/My Tasks/Calendar above follow
            (unlike Members/Archive/Templates/Trash, which are role-gated
            because their *pages*, not just their data, are off-limits to
            a guest). `flex-1 min-h-0` here (not on the primary nav above)
            is what makes this the section that grows to fill remaining
            space within this wrapper and scrolls internally under normal
            conditions (F119, AS-069) -- see project-nav-list.tsx's own
            comment for why the inner Collapsible also needs `flex-1
            min-h-0` all the way down for that scroll to actually engage. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ProjectNavList
            workspaceSlug={workspaceSlug}
            workspaceId={currentWorkspaceId}
            projects={projects}
            onNavigate={onNavigate}
          />
        </div>
      </div>
      {showFade ? (
        <div
          aria-hidden="true"
          data-testid="sidebar-bottom-fade"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-sidebar to-transparent"
        />
      ) : null}
      </div>

      {/* UX: `shrink-0` makes explicit what was already true structurally
          (this footer is a sibling of the `flex-1 min-h-0` middle wrapper
          above, inside the `h-svh flex-col` <aside>, so it was never
          actually pushed off-screen by a long Projects list) -- but the
          plain `border-t` alone read as an afterthought tacked onto the
          bottom of a scrolling list rather than a deliberate, anchored
          section. `bg-sidebar-accent/40` gives it its own visually
          distinct surface (same idea as portal-sidebar.tsx's own footer)
          so identity + sign-out reads as a permanent block of the shell,
          not content that happened to land at the bottom. */}
      <div className="flex shrink-0 flex-col gap-2 border-t bg-sidebar-accent/40 p-3">
        {/* F002 (SB-012, SB-013, SB-014, SB-015): the footer avatar row is
            now a single AccountMenu trigger (Profile / Settings /
            Theme / Sign out) replacing the plain profile Link + standalone
            <ThemeToggle/> (moved out of the header row above) + standalone
            <SignOutButton/> (removed) it used to be — see that
            component's own doc comment. */}
        <AccountMenu
          workspaceSlug={workspaceSlug}
          currentUser={currentUser}
          canManageWorkspace={canManageWorkspace}
          isGuest={isGuest}
          hasClient={hasClient}
          onNavigate={onNavigate}
        />
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
  approvalsCount = 0,
  requestsCount = 0,
  chatUnreadCount = 0,
  approvalsBadge,
  requestsBadge,
  chatUnreadBadge,
  inboxBadge,
  workspaceSwitcherSlot,
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
  /** F010: open-approvals count for the "Approvals" nav item's badge —
   * server-fetched by the layout via `getOpenApprovalsForWorkspace(...).length`.
   * Default `0` keeps every existing caller/test rendering the item with
   * no badge instead of crashing. */
  approvalsCount?: number;
  /** F083: open client-request count for the "Client requests" nav
   * item's badge — server-fetched by the layout via
   * `getOpenClientRequestCountForWorkspace(...)`. Default `0` keeps every
   * existing caller/test rendering the item with no badge instead of
   * crashing. */
  requestsCount?: number;
  /** Feature request (sidebar unread badges): total unread chat messages,
   * see SidebarContent's own doc comment for this prop. */
  chatUnreadCount?: number;
  /** F016 (AS-017): streamed badge/bell/switcher slots — see
   * SidebarContent's own doc comments for each. Threaded straight through
   * to every `<SidebarContent>` instance below (desktop + mobile sheet)
   * and to this component's own standalone mobile-bar bell. */
  approvalsBadge?: React.ReactNode;
  requestsBadge?: React.ReactNode;
  chatUnreadBadge?: React.ReactNode;
  /** F014 (SB-053, SB-054, SB-055): the "Inbox" nav item's own aggregate
   * badge — see SidebarContent's own doc comment for this prop. Replaces
   * the removed `notificationBellSlot`/`<NotificationBell>` (both desktop
   * and mobile) entirely; there is no more standalone bell anywhere in
   * this component. */
  inboxBadge?: React.ReactNode;
  workspaceSwitcherSlot?: React.ReactNode;
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
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col self-start bg-sidebar text-sidebar-foreground md:flex">
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
          approvalsCount={approvalsCount}
          requestsCount={requestsCount}
          chatUnreadCount={chatUnreadCount}
          approvalsBadge={approvalsBadge}
          requestsBadge={requestsBadge}
          chatUnreadBadge={chatUnreadBadge}
          inboxBadge={inboxBadge}
          workspaceSwitcherSlot={workspaceSwitcherSlot}
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
          <SheetContent side="left" className="w-64 data-[side=left]:w-64 p-0">
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
              approvalsCount={approvalsCount}
              requestsCount={requestsCount}
              chatUnreadCount={chatUnreadCount}
              approvalsBadge={approvalsBadge}
              requestsBadge={requestsBadge}
              chatUnreadBadge={chatUnreadBadge}
              inboxBadge={inboxBadge}
              workspaceSwitcherSlot={workspaceSwitcherSlot}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        {/* F014: the bell that used to sit here (F208) is gone -- its
            unread count is folded into the "Inbox" nav item's own badge
            inside the Sheet above (reachable on mobile the same way every
            other nav item is), and its realtime side effects moved to
            NotificationsRealtimeEffects (mounted once by the workspace
            layout, not duplicated per responsive breakpoint here). F002
            (SB-013): the standalone <ThemeToggle/> that used to sit here
            is removed -- theme is now reachable on mobile via the
            AccountMenu inside the Sheet's own SidebarContent footer
            (SB-009: same nav tree, including the account menu trigger,
            renders in the mobile Sheet as on desktop). */}
      </div>
    </>
  );
}

// F256 (AS-497/AS-499): a standalone sign-out control with a
// useTransition + disabled-while-pending shape. NOTE (F026): this is NOT
// rendered by AppSidebar any more -- sign-out now lives in AccountMenu
// (components/nav/account-menu.tsx). It is kept exported only so
// tests/unit/optimistic-pending-audit.test.tsx can keep asserting the
// pending/double-submit shape; the portal has its own copy in
// components/portal/portal-sign-out-button.tsx. Do not assume it appears
// in the sidebar UI.
export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await signOut();
        if (result && result.ok === false) toast.error(result.error);
      } catch {
        toast.error("Couldn't sign out. Please try again.");
      }
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
