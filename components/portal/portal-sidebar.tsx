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
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";
import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
import { SignOutButton } from "@/components/portal/portal-sign-out-button";
import type { PortalBadgeCounts, PortalBillingModel } from "@/lib/queries/portal";

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
// Paket B (client-portal redesign, `projects.billing_model`): defaults
// to "fixed_price" (the DB column's own default) when a caller doesn't
// pass one, so any test/call site written before this parameter existed
// keeps its old seven-item behaviour rather than silently losing Hours --
// but every real call site now threads the project's actual value
// through instead of relying on this fallback.
export function buildPortalNavItems(
  basePath: string,
  badges: PortalBadgeCounts,
  billingModel: PortalBillingModel = "fixed_price",
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
    // Paket B: a fixed-price project has no hourly billing to show the
    // client -- Hours is omitted from the nav entirely (not shown
    // disabled/greyed) rather than pointing at a route that 404s.
    ...(billingModel === "hourly"
      ? [{ key: "hours", label: "Hours", href: `${basePath}/hours`, icon: Clock }]
      : []),
    { key: "scope", label: "Scope & decisions", href: `${basePath}/scope`, icon: ScrollText },
    { key: "site", label: "Your site", href: `${basePath}/site`, icon: Globe },
  ];
}

// TEMPORARY (F006e, missions/20260903-portal M1 remediation): Requests
// has no other entry point besides this row and (as of F023) the "Your
// site" view's own "More" section. F003 deleted `portal-nav.tsx` (the
// only link to it); F003b then relocated the route under this project
// shell without adding a replacement, so until F006e it was unreachable
// UI -- and Requests is the client's only *write* path in the whole
// portal. F003b's own spec says Requests belongs inside "Scope &
// decisions" (F016) once that view exists; it is still a stub today.
// Files had the identical problem and identical fix, but F023 (this
// mission's M5) gives it a permanent home inside "Your site" per F003b's
// own spec, so its row here was removed -- DELETE this function and its
// remaining call site the moment F016 lands with a real entry point for
// Requests; do not carry it forward as a permanent nav item.
//
// F116 (docs/client-portal-phase-2-plan.md item A): Conversation joins
// this row too, deliberately NOT as a tenth item in `buildPortalNavItems`.
// A review already called the eight primary views borderline too many; a
// ninth item used constantly (chat) belongs in the tier that is already
// visually secondary, not one that grows the primary set further. Unlike
// Requests this is NOT temporary -- there is no future feature that gives
// chat a "real" home elsewhere the way Scope & decisions will eventually
// absorb Requests, so this row stays.
export function buildPortalSecondaryNavItems(basePath: string): PortalNavItem[] {
  return [
    { key: "requests", label: "Requests", href: `${basePath}/requests`, icon: Inbox },
    { key: "conversation", label: "Conversation", href: `${basePath}/conversation`, icon: MessageSquare },
    // A3 (Paket A, client-portal redesign): "How we work" moved out of
    // "Your site" into its own route -- secondary tier, same reasoning
    // as Requests/Conversation above: useful but not one of the eight
    // views reviewed constantly, and content here rarely changes once a
    // project is underway.
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
  // TEMPORARY (F006e): "secondary" renders smaller and dimmer than the
  // eight primary views, per this feature's own "visually secondary"
  // instruction -- delete this prop along with `buildPortalSecondaryNavItems`
  // once F016/F023 give Files and Requests a permanent home.
  variant = "primary",
  // F085 (missions/20260903-portal audit, layout defect): `w-full` only
  // makes sense inside the desktop `<aside>`'s vertical `<nav>`, where
  // every row should fill the sidebar's width. The mobile strip
  // (`overflow-x-auto`, below) is a horizontal flex row -- `w-full` there
  // means "100% of the row", so the FIRST item fills the whole scroll
  // container and every other item is pushed off-screen (at 375px, only
  // "Overview" was ever visible). Defaults to "desktop" so the existing
  // `<aside>` call sites are unchanged.
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
          ? "gap-2 px-3 py-1.5 text-tag"
          : "gap-2.5 px-3 py-2 text-mini font-medium",
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
  badges: PortalBadgeCounts;
  billingModel: PortalBillingModel;
  currentUser: UserAvatarPerson;
}) {
  const pathname = usePathname();
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  const items = buildPortalNavItems(basePath, badges, billingModel);
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
        <span className="truncate text-mini font-semibold tracking-tight">
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
      <span className="truncate text-mini font-medium">{projectName}</span>
    </Link>
  ) : (
    <div className="flex flex-col gap-0.5 rounded-md border border-sidebar-border px-3 py-2">
      <span className="text-tag text-sidebar-foreground/60">Project</span>
      <span className="truncate text-mini font-medium">{projectName}</span>
    </div>
  );

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <UserAvatar person={currentUser} size="sm" />
      <span className="min-w-0 flex-1 truncate text-mini font-medium">
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
          <div className="flex items-center justify-end gap-2">
            <SignOutButton workspaceSlug={workspaceSlug} />
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
              layout="mobile"
            />
          ))}
        </nav>
      </div>
    </>
  );
}
