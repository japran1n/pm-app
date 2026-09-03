"use client";

// F003 (missions/20260903-portal, AS-004, AS-005): the sticky topbar over
// the view container -- a mono uppercase breadcrumb eyebrow, the current
// view's title, and the two launch chips. Client Component for the same
// single reason as `portal-sidebar.tsx`: the "view title" is derived from
// `usePathname()` against the same nav item list the sidebar builds, so
// the two never name a view differently. Everything else here (project
// name, launch date/confidence) is server-fetched and passed down as
// plain props -- this component makes no query of its own.
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buildPortalNavItems, type PortalBadgeCounts } from "@/components/portal/portal-sidebar";
import type { PortalLaunchConfidence } from "@/lib/queries/portal";

const CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

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
  badges,
  targetLaunchDate,
  launchConfidence,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
  badges: PortalBadgeCounts;
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
}) {
  const pathname = usePathname();
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  const items = buildPortalNavItems(basePath, badges);
  // Exact match first (this is how "Overview" itself, whose own href IS
  // `basePath`, gets picked); the prefix fallback deliberately excludes
  // `exact` items, since Overview's href is a literal PREFIX of every
  // other item's href (`${basePath}/approvals`, etc) and would otherwise
  // always win the prefix search first, mislabeling every other view as
  // "Overview" -- the exact same footgun `isItemActive`
  // (`portal-sidebar.tsx`) avoids for the same reason.
  const active =
    items.find((item) => pathname === item.href) ??
    items.find((item) => !item.exact && pathname.startsWith(`${item.href}/`)) ??
    items[0];

  return (
    <header className="sticky top-0 z-10 flex flex-col gap-1 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
      <span className="text-tag text-muted-foreground">{projectName}</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h4 font-semibold tracking-tight">{active.label}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Launch {formatLaunchDate(targetLaunchDate)}</Badge>
          <Badge variant="outline">
            {launchConfidence ? CONFIDENCE_LABEL[launchConfidence] : "Confidence —"}
          </Badge>
        </div>
      </div>
    </header>
  );
}
