"use client";

// F003 (missions/20260903-portal, AS-001, AS-004, AS-006): the portal's
// persistent shell nav, replacing `portal-nav.tsx` (a two-item top bar
// left over from the pre-prototype, workspace-first portal). This is the
// prototype's own left sidebar: brand, a project card, the eight views,
// and a footer holding the signed-in client's identity, the theme toggle
// and sign-out.
//
// Client Component (same reason `portal-nav.tsx` and
// `components/nav/app-sidebar.tsx` both are): `usePathname()` is the only
// way to know which of the eight views is active for `aria-current`
// (AS-001/AS-004), and the layout wrapping this is a Server Component
// that fetches everything this needs and passes it down as plain props --
// this component makes no query of its own.
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
import {
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Paperclip,
  ScrollText,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";
import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
import { SignOutButton } from "@/components/portal/portal-sign-out-button";
import type { PortalBadgeCounts } from "@/lib/queries/portal";

// F006f (missions/20260903-portal, AS-002): re-exported, not redefined --
// `lib/queries/portal.ts` is this shape's one source of truth (its
// `approvalsAwaiting` field is a `PortalQueryResult`, not a plain
// number, since a failed read is a different value from a real zero). A
// second, hand-copied definition here could drift from the query's own
// return type without either side's compiler catching it.
export type { PortalBadgeCounts };

export type PortalNavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Present only for the two items AS-002/AS-003 assign a badge to.
   * `undefined` (not 0) means "this item never carries a badge" --
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

// The eight views, in the prototype's own order (AS-001's assertion text
// lists them in this exact order). `basePath` is
// `/portal/<slug>/p/<projectId>` -- Overview is that path's INDEX route
// (see p/[projectId]/page.tsx), not a `/overview` sub-route, so its
// `href` is `basePath` itself and its match is `exact`.
export function buildPortalNavItems(
  basePath: string,
  badges: PortalBadgeCounts,
): PortalNavItem[] {
  return [
    { key: "overview", label: "Overview", href: basePath, icon: LayoutDashboard, exact: true },
    {
      key: "approvals",
      label: "Approvals",
      href: `${basePath}/approvals`,
      icon: CheckCircle2,
      // F006f (missions/20260903-portal, AS-002): a failed read renders
      // no badge at all (the same "undefined, not 0" honesty this
      // object's own comment above already documents for a real zero) --
      // never a `0` a client cannot tell apart from "nothing is waiting
      // on you".
      badge: badges.approvalsAwaiting.ok ? badges.approvalsAwaiting.data : undefined,
      badgeTone: "neutral",
    },
    {
      key: "your-list",
      label: "Your list",
      href: `${basePath}/your-list`,
      icon: ListChecks,
      badge: badges.deliverablesPastDue,
      badgeTone: "danger",
    },
    { key: "pages", label: "Pages", href: `${basePath}/pages`, icon: FileText },
    { key: "hours", label: "Hours", href: `${basePath}/hours`, icon: Clock },
    { key: "results", label: "Results", href: `${basePath}/results`, icon: TrendingUp },
    { key: "scope", label: "Scope & decisions", href: `${basePath}/scope`, icon: ScrollText },
    { key: "site", label: "Your site", href: `${basePath}/site`, icon: Globe },
  ];
}

// TEMPORARY (F006e, missions/20260903-portal M1 remediation): Files and
// Requests have no other entry point. F003 deleted `portal-nav.tsx`
// (the only link to them); F003b then relocated both routes under this
// project shell without adding a replacement, so until this feature they
// were unreachable UI -- and Requests is the client's only *write* path
// in the whole portal. F003b's own spec says they belong inside "Your
// site" (F023) and "Scope & decisions" (F016) once those views exist;
// both are still stubs today. This function -- and the secondary section
// `PortalSidebar` renders it into below -- exist ONLY to bridge that gap.
// DELETE this function and its call sites the moment F016 and F023 land
// with a real entry point for these two views; do not carry them forward
// as permanent nav items.
export function buildPortalSecondaryNavItems(basePath: string): PortalNavItem[] {
  return [
    { key: "files", label: "Files", href: `${basePath}/files`, icon: Paperclip },
    { key: "requests", label: "Requests", href: `${basePath}/requests`, icon: Inbox },
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
  // TEMPORARY (F006e): "secondary" renders smaller and dimmer than the
  // eight primary views, per this feature's own "visually secondary"
  // instruction -- delete this prop along with `buildPortalSecondaryNavItems`
  // once F016/F023 give Files and Requests a permanent home.
  variant = "primary",
}: {
  item: PortalNavItem;
  active: boolean;
  onNavigate?: () => void;
  variant?: "primary" | "secondary";
}) {
  const Icon = item.icon;
  return (
    <Link
      key={item.key}
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex w-full shrink-0 items-center rounded-md transition-colors",
        variant === "secondary"
          ? "gap-2 px-3 py-1.5 text-tag"
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

export function PortalSidebar({
  workspaceSlug,
  workspaceId,
  workspaceName,
  workspaceLogoUrl,
  projectId,
  projectName,
  hasMultipleProjects,
  badges,
  currentUser,
}: {
  workspaceSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceLogoUrl: string | null;
  projectId: string;
  projectName: string;
  hasMultipleProjects: boolean;
  badges: PortalBadgeCounts;
  currentUser: UserAvatarPerson;
}) {
  const pathname = usePathname();
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  const items = buildPortalNavItems(basePath, badges);
  // TEMPORARY (F006e) -- see `buildPortalSecondaryNavItems`'s own comment.
  const secondaryItems = buildPortalSecondaryNavItems(basePath);

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
        <span className="text-tag text-sidebar-foreground/60">Client portal</span>
      </span>
    </Link>
  );

  const projectCard = hasMultipleProjects ? (
    <Link
      href={`/portal/${workspaceSlug}`}
      className="hover-surface flex flex-col gap-0.5 rounded-md border border-sidebar-border px-3 py-2"
    >
      <span className="text-tag text-sidebar-foreground/60">Project</span>
      <span className="truncate text-sm font-medium">{projectName}</span>
    </Link>
  ) : (
    <div className="flex flex-col gap-0.5 rounded-md border border-sidebar-border px-3 py-2">
      <span className="text-tag text-sidebar-foreground/60">Project</span>
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

          {/* TEMPORARY (F006e) -- see `buildPortalSecondaryNavItems`'s
              own comment for why these two rows exist and when to
              remove them. */}
          <div className="mt-2 flex flex-col gap-0.5 border-t border-sidebar-border pt-2">
            {secondaryItems.map((item) => (
              <NavRow
                key={item.key}
                item={item}
                active={isItemActive(pathname, item)}
                variant="secondary"
              />
            ))}
          </div>
        </nav>

        <div className="flex flex-col gap-3 border-t border-sidebar-border p-3">
          {identity}
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Mobile (below the app's `md` breakpoint, AS-001's own "Notes"):
          the sidebar collapses to a horizontal scrolling nav above the
          content -- not a hamburger drawer, so identity/theme/sign-out
          stay reachable in the same compact strip rather than behind an
          extra tap. */}
      <div className="flex flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {brand}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <div className="px-3 pb-2">{projectCard}</div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {items.map((item) => (
            <NavRow key={item.key} item={item} active={isItemActive(pathname, item)} />
          ))}
          {/* TEMPORARY (F006e) -- see `buildPortalSecondaryNavItems`'s
              own comment for why these two rows exist and when to
              remove them. Same horizontal strip, no separate row on
              mobile (there is no vertical space to spare for one). */}
          {secondaryItems.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              active={isItemActive(pathname, item)}
              variant="secondary"
            />
          ))}
        </nav>
      </div>
    </>
  );
}
