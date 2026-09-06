"use client";

// F003 (missions/20260903-portal, AS-004, AS-005): the sticky topbar over
// the view container -- a mono uppercase project-name eyebrow (NOT a
// multi-segment breadcrumb -- the portal is one project deep, so a
// single line naming the current project is the whole trail; checked
// under F006e's own "check the breadcrumb for the same failure"
// instruction and confirmed route-independent: it renders `projectName`
// unconditionally, the same on every one of the eleven routes under this
// shell, so it was never at risk of the title bug below), the current
// view's title, and the two launch chips. Everything but the title is
// server-fetched and passed down as plain props -- this component makes
// no query of its own.
//
// F107 round 2 (missions/20260903-portal, docs/client-portal-visual-plan.md
// 2.1): the two launch chips are hidden on the Overview route only. The
// Overview page now opens with `LaunchHeadline` -- "On track / Launching
// 4 October 2026" at `text-h2`, plus the `launch_note` sentence -- and
// rendering the SAME two facts again immediately above it, at a fraction
// of the size, is the "two headlines competing" defect the coordinator's
// review named directly. AS-005 ("the client can see the project's
// target launch date and current launch confidence") does not require
// BOTH surfaces to show it on the SAME view -- the Overview route still
// states both facts, once, more prominently than the chip ever did; the
// chip continues to answer the same question on the other ten routes
// under this shell, where no headline exists to duplicate. AS-005's own
// tests (`portal-topbar.test.tsx`) were updated to assert the chip on a
// non-Overview route and its ABSENCE on Overview, rather than dropping
// the assertion.
//
// F006e (missions/20260903-portal, AS-004): the view title used to be
// looked up in `buildPortalNavItems`'s eight-item list -- so any route
// NOT in that list (files, requests, task detail) fell through to
// `items[0]` and always printed "Overview". Fixed by decoupling title
// resolution from the sidebar's nav-item list entirely: the title now
// comes from matching the pathname's first segment after `basePath`
// against a dedicated route-title map (covering every route under this
// shell, sidebar-visible or not) with a humanized fallback, so a route
// neither list has ever heard of still gets a
// reasonable title instead of "Overview" -- "titled correctly by
// construction rather than by someone remembering to update a second
// list", per this feature's own spec. Task detail is the one route with
// no static title (a task's own title isn't in any list); its real title
// arrives via `usePortalTitleOverride()`, announced by
// `PortalTaskTitleAnnouncer` from the page that fetches it (see
// `portal-title-context.tsx`).
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { usePortalTitleOverride } from "@/components/portal/portal-title-context";
import { PortalLinkStrip, type PortalKeyLink } from "@/components/portal/portal-link-strip";
import type { PortalLaunchConfidence } from "@/lib/queries/portal";

const CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

// The eight primary views' own titles, kept here (not read from
// `buildPortalNavItems`) so this map covers every route under the shell,
// not only the ones the sidebar happens to display -- see this file's
// own header comment for why that distinction is the whole fix.
const STATIC_ROUTE_TITLES: Record<string, string> = {
  "": "Overview",
  approvals: "Approvals",
  "your-list": "Your list",
  pages: "Pages",
  hours: "Hours",
  results: "Results",
  scope: "Scope & decisions",
  site: "Your site",
  // TEMPORARY (F006e) -- see `buildPortalSecondaryNavItems` in
  // `portal-sidebar.tsx`. Remove alongside that function.
  files: "Files",
  requests: "Requests",
  "how-we-work": "How we work",
};

// A path segment humanizes into a Title Case guess ("deliverables" ->
// "Deliverables", "site-map" -> "Site Map") when it isn't in
// `STATIC_ROUTE_TITLES` above -- the DoD's own failure test: a route
// added later without touching any list still gets a real title instead
// of silently mislabeling itself "Overview".
function humanizeSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Exported for its own unit test: resolves the static (route-only)
 * title for any pathname under `basePath`. Does NOT know about the task
 * detail route's real title (that's a runtime override, not a static
 * route table) -- callers needing that combine this with
 * `usePortalTitleOverride()`, as `PortalTopbar` does below. */
export function resolvePortalStaticTitle(pathname: string, basePath: string): string {
  if (pathname === basePath) return STATIC_ROUTE_TITLES[""];

  const rest = pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length + 1)
    : pathname;
  const [firstSegment] = rest.split("/");

  if (firstSegment === "t") return "Task";

  return STATIC_ROUTE_TITLES[firstSegment] ?? humanizeSegment(firstSegment);
}

function formatLaunchDate(iso: string | null): string {
  if (!iso) return "—";
  // Same fixed en-GB short form + UTC pin as `project-progress.tsx`'s
  // `formatDate`, for the same server/client hydration reason -- this
  // renders on the client (usePathname needs it) but is seeded from a
  // server-fetched ISO date string, so the format must still be
  // locale-independent to match a first server-rendered paint.
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PortalTopbar({
  workspaceSlug,
  projectId,
  projectName,
  targetLaunchDate,
  launchConfidence,
  keyLinks,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
  // F113 (client-portal-phase-2-plan.md item B): Figma/staging/live,
  // rendered as `PortalLinkStrip` below. Optional so every existing
  // caller/test that doesn't pass it keeps rendering exactly as before
  // (no strip, not a crash).
  keyLinks?: PortalKeyLink[];
}) {
  const pathname = usePathname();
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  const titleOverride = usePortalTitleOverride();
  const title = titleOverride ?? resolvePortalStaticTitle(pathname, basePath);
  // F107 round 2: the Overview route is exactly where `resolvePortalStaticTitle`
  // already treats `pathname === basePath` as its own case (the function's
  // own first branch) -- reusing that identical comparison here instead of
  // a second, differently-spelled check.
  const isOverviewRoute = pathname === basePath;

  return (
    <header className="sticky top-0 z-10 flex flex-col gap-1 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
      <span className="text-tag text-muted-foreground">{projectName}</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h4 font-semibold tracking-tight">{title}</h1>
        {!isOverviewRoute && (
          <div className="flex flex-wrap items-center gap-2" data-testid="topbar-launch-chips">
            <Badge variant="outline">Launch {formatLaunchDate(targetLaunchDate)}</Badge>
            <Badge variant="outline">
              {launchConfidence ? CONFIDENCE_LABEL[launchConfidence] : "Confidence —"}
            </Badge>
          </div>
        )}
      </div>
      {keyLinks && <PortalLinkStrip links={keyLinks} />}
    </header>
  );
}
