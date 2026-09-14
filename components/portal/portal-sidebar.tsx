"use client";

// F003 (missions/20260903-portal, AS-001, AS-004, AS-006): the portal's
// persistent shell nav, replacing `portal-nav.tsx` (a two-item top bar
// left over from the pre-prototype, workspace-first portal). This is the
// prototype's own left sidebar: brand, a project card, the primary
// views, and a footer holding the signed-in client's identity, the theme
// toggle and sign-out.
//
// Mission 20260914-portal-simplify, F008 (AS-014, AS-015, AS-016):
// collapsed from the eight-item (later ten-item, split primary/secondary)
// nav down to four top-level entries -- Home, For you, Messages, and an
// expandable "Project" group holding everything else. `buildPortalNavItems`
// now returns only the three flat top-level rows; `buildPortalSecondaryNavItems`
// is gone (there is no more visually-secondary tier) and its old
// call sites/behaviour are replaced by `buildPortalProjectNavItems`, the
// Project group's own children.
//
// Client Component (same reason `portal-nav.tsx` and
// `components/nav/app-sidebar.tsx` both are): `usePathname()` is the only
// way to know which view is active for `aria-current` (AS-016), and the
// layout wrapping this is a Server Component that fetches everything this
// needs and passes it down as plain props -- this component makes no
// query of its own.
//
// Renders two representations of the SAME nav data, exactly the way
// `app-sidebar.tsx` renders a desktop `<aside>` and a mobile
// `Sheet`-backed drawer from one `navGroups()` call -- except the
// prototype's own mobile spec (F003's clarified spec, section 1) is not a
// hamburger drawer but "a horizontal scrolling nav above the content", so
// the mobile branch here is a plain `overflow-x-auto` row instead of a
// `Sheet`.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Clock,
  FileQuestion,
  FileText,
  FolderKanban,
  Globe,
  Home,
  LayoutTemplate,
  ListChecks,
  MessageSquare,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";
import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
import { SignOutButton } from "@/components/portal/portal-sign-out-button";
import type { PortalBillingModel } from "@/lib/queries/portal";

// Mission 20260914-portal-simplify, F005 (AS-007): the single number
// this nav's "For you" badge renders -- `getWaitingOnYouCount`'s own
// `{ decisions, materials, total, overdue }` shape, already the same
// read the Home callout (F010) uses, so the two can never disagree. A
// failed read renders no badge at all (same "undefined, not 0" honesty
// rule the old `PortalBadgeCounts` shape used before this feature
// replaced it).
export type PortalForYouBadge =
  | { ok: true; total: number; overdue: number }
  | { ok: false };

export type PortalNavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  /** `undefined` (not 0) means "this item never carries a badge" --
   * distinct from a real, current count of 0, which renders nothing per
   * `NavBadge` below (a "0" badge on every visit would be noise, not
   * data). */
  badge?: number;
  /** F003 Notes: "badge for overdue counts uses the blocked status
   * token" -- until F004 adds `--status-blocked`, `destructive` is this
   * app's own existing semantic-danger token (`components/ui/badge.tsx`),
   * reused rather than a new color invented for this one badge. */
  badgeTone?: "neutral" | "danger";
};

// The three top-level rows (AS-014's own list, in order). `basePath` is
// `/portal/<slug>/p/<projectId>` -- Home is that path's INDEX route (see
// p/[projectId]/page.tsx), not a `/home` sub-route, so its `href` is
// `basePath` itself and its match is `exact`.
export function buildPortalNavItems(
  basePath: string,
  forYouBadge: PortalForYouBadge,
): PortalNavItem[] {
  return [
    { key: "home", label: "Home", href: basePath, icon: Home, exact: true },
    {
      key: "for-you",
      label: "For you",
      href: `${basePath}/for-you`,
      icon: Sparkles,
      // AS-007/F005: a failed read renders no badge at all -- never a
      // `0` a client cannot tell apart from "nothing is waiting on you".
      badge: forYouBadge.ok ? forYouBadge.total : undefined,
      badgeTone: forYouBadge.ok && forYouBadge.overdue > 0 ? "danger" : "neutral",
    },
    { key: "messages", label: "Messages", href: `${basePath}/conversation`, icon: MessageSquare },
  ];
}

// The "Project" group's children (AS-014/AS-015's own list, in order).
// Hours is omitted entirely (not shown disabled/greyed) for a fixed-price
// project -- same Paket B rule the old flat nav applied.
export function buildPortalProjectNavItems(
  basePath: string,
  billingModel: PortalBillingModel = "fixed_price",
): PortalNavItem[] {
  return [
    { key: "pages", label: "Pages", href: `${basePath}/pages`, icon: FileText },
    // "Architecture" is labelled "Site map" in the portal (user decision,
    // plan.md's own header) -- the route itself is unchanged.
    { key: "architecture", label: "Site map", href: `${basePath}/architecture`, icon: LayoutTemplate },
    { key: "site", label: "Your site", href: `${basePath}/site`, icon: Globe },
    { key: "scope", label: "Scope & decisions", href: `${basePath}/scope`, icon: ScrollText },
    // AS-015: Results is now reachable from portal navigation (audit gap 3).
    { key: "results", label: "Results", href: `${basePath}/results`, icon: ListChecks },
    ...(billingModel === "hourly"
      ? [{ key: "hours", label: "Hours", href: `${basePath}/hours`, icon: Clock }]
      : []),
    // AS-015: Questionnaire (brief) is now reachable from portal
    // navigation (audit gap 4).
    { key: "brief", label: "Questionnaire", href: `${basePath}/brief`, icon: FileQuestion },
    { key: "how-we-work", label: "How we work", href: `${basePath}/how-we-work`, icon: BookOpen },
  ];
}

function isItemActive(pathname: string, item: PortalNavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavBadge({ item }: { item: PortalNavItem }) {
  if (!item.badge) return null;
  return (
    <Badge
      variant={item.badgeTone === "danger" ? "destructive" : "secondary"}
      className="ml-auto h-5 min-w-5 justify-center px-1"
    >
      {item.badge > 99 ? "99+" : item.badge}
    </Badge>
  );
}

function NavRow({
  item,
  active,
  onNavigate,
  variant = "primary",
  // F085 (missions/20260903-portal audit, layout defect): `w-full` only
  // makes sense inside the desktop `<aside>`'s vertical `<nav>`, where
  // every row should fill the sidebar's width. The mobile strip
  // (`overflow-x-auto`, below) is a horizontal flex row -- `w-full` there
  // means "100% of the row", so the FIRST item fills the whole scroll
  // container and every other item is pushed off-screen. Defaults to
  // "desktop" so the existing `<aside>` call sites are unchanged.
  layout = "desktop",
}: {
  item: PortalNavItem;
  active: boolean;
  onNavigate?: () => void;
  variant?: "primary" | "secondary";
  layout?: "desktop" | "mobile";
}) {
  const Icon = item.icon;
  return (
    <Link
      key={item.key}
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex shrink-0 items-center rounded-md transition-colors",
        layout === "desktop" && "w-full",
        variant === "secondary"
          ? "gap-2 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.07em]"
          : "gap-2.5 px-3 py-2 text-sm font-medium",
        active
          ? "bg-primary text-primary-foreground"
          : variant === "secondary"
            ? "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon
        className={variant === "secondary" ? "size-3.5 shrink-0" : "size-4 shrink-0"}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <NavBadge item={item} />
    </Link>
  );
}

// F008 (AS-016): "Project" is a fourth top-level row that expands into
// its own children rather than a `Link`. It auto-expands (and cannot be
// collapsed) while the user is actually on one of its child routes --
// `forceExpanded` -- but is otherwise plain user-toggled state, per this
// feature's own spec ("collapsed/expanded otherwise toggled by the
// user"). The button carries `aria-expanded` so its open/closed state is
// programmatically discoverable, matching `app-sidebar.tsx`'s own
// disclosure convention.
function ProjectNavGroup({
  projectItems,
  pathname,
  expanded,
  onToggle,
  onNavigate,
  layout,
}: {
  projectItems: PortalNavItem[];
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  layout: "desktop" | "mobile";
}) {
  return (
    <div className={cn(layout === "mobile" && "flex shrink-0 items-center gap-1")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          layout === "desktop" && "w-full",
        )}
      >
        <FolderKanban className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">Project</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div
          className={cn(
            layout === "desktop"
              ? "flex flex-col gap-0.5 pl-2"
              : "flex shrink-0 items-center gap-1",
          )}
        >
          {projectItems.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              active={isItemActive(pathname, item)}
              variant="secondary"
              layout={layout}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PortalSidebar({
  workspaceSlug,
  workspaceId,
  workspaceName,
  workspaceLogoUrl,
  projectId,
  projectName,
  hasMultipleProjects,
  forYouBadge,
  billingModel,
  currentUser,
}: {
  workspaceSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceLogoUrl: string | null;
  projectId: string;
  projectName: string;
  hasMultipleProjects: boolean;
  forYouBadge: PortalForYouBadge;
  billingModel: PortalBillingModel;
  currentUser: UserAvatarPerson;
}) {
  const pathname = usePathname();
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  const items = buildPortalNavItems(basePath, forYouBadge);
  const projectItems = buildPortalProjectNavItems(basePath, billingModel);

  // AS-016: the Project group is expanded (and its active child marked
  // current) on ANY child route, including nested ones (e.g.
  // `/pages/<id>`) -- `isItemActive` already treats a child's own href as
  // a prefix match. Off a child route, expansion is whatever the user
  // last toggled it to (defaults closed).
  const isOnProjectRoute = projectItems.some((item) => isItemActive(pathname, item));
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const expanded = isOnProjectRoute || manuallyExpanded;

  const toggleProject = () => setManuallyExpanded((value) => !value);

  const brand = (
    <Link href={`/portal/${workspaceSlug}`} className="flex items-center gap-2.5">
      <WorkspaceLogo
        workspaceId={workspaceId}
        name={workspaceName}
        logoUrl={workspaceLogoUrl}
        size="sm"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold tracking-tight">
          {workspaceName}
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.07em] text-sidebar-foreground/60">Client portal</span>
      </span>
    </Link>
  );

  const projectCard = hasMultipleProjects ? (
    <Link
      href={`/portal/${workspaceSlug}`}
      className="hover-surface flex flex-col gap-0.5 rounded-md border border-sidebar-border px-3 py-2"
    >
      <span className="text-xs font-medium uppercase tracking-[0.07em] text-sidebar-foreground/60">Project</span>
      <span className="truncate text-sm font-medium">{projectName}</span>
    </Link>
  ) : (
    <div className="flex flex-col gap-0.5 rounded-md border border-sidebar-border px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.07em] text-sidebar-foreground/60">Project</span>
      <span className="truncate text-sm font-medium">{projectName}</span>
    </div>
  );

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <UserAvatar person={currentUser} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {personLabel(currentUser)}
      </span>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed-width sticky sidebar, own scroll -- same
          `sticky top-0` + `h-svh` shape as `app-sidebar.tsx`'s `<aside>`,
          for the same reason (stays a real flex item, no compensating
          margin needed on the main column). */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex flex-col gap-4 border-b border-sidebar-border p-4">
          {brand}
          {projectCard}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {items.map((item) => (
            <NavRow key={item.key} item={item} active={isItemActive(pathname, item)} />
          ))}

          <ProjectNavGroup
            projectItems={projectItems}
            pathname={pathname}
            expanded={expanded}
            onToggle={toggleProject}
            layout="desktop"
          />
        </nav>

        <div className="flex flex-col gap-3 border-t border-sidebar-border p-3">
          {identity}
          <div className="flex items-center justify-end gap-2">
            <SignOutButton workspaceSlug={workspaceSlug} />
          </div>
        </div>
      </aside>

      {/* Mobile (below the app's `md` breakpoint, AS-001's own "Notes"):
          the sidebar collapses to a horizontal scrolling nav above the
          content -- not a hamburger drawer, so identity/theme/sign-out
          stay reachable in the same compact strip rather than behind an
          extra tap. Exposes the same four-row structure (Home, For you,
          Messages, Project [+children]) as the desktop `<aside>`. */}
      <div className="flex flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {brand}
          <div className="flex items-center gap-2">
            <SignOutButton workspaceSlug={workspaceSlug} />
          </div>
        </div>
        <div className="px-3 pb-2">{projectCard}</div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {items.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              active={isItemActive(pathname, item)}
              layout="mobile"
            />
          ))}
          <ProjectNavGroup
            projectItems={projectItems}
            pathname={pathname}
            expanded={expanded}
            onToggle={toggleProject}
            layout="mobile"
          />
        </nav>
      </div>
    </>
  );
}
