// A1 (Paket A, client-portal redesign): shared brand-adjacent icon per
// `ProjectLinkKind` (lib/queries/project-site.ts), used everywhere a
// project link is rendered (`PortalLinkStrip`, `ProjectLinksList`) so the
// mapping lives in exactly one place instead of drifting between two
// generic-icon call sites.
//
// Deliberately NOT real brand SVG logos (trademark risk) -- each kind
// gets a visually distinct Lucide icon plus a brand-adjacent accent
// color, so a client scanning the list can tell services apart at a
// glance without this app claiming to render anyone's actual logo.
import {
  BarChart3,
  FlaskConical,
  FolderOpen,
  Frame,
  Globe,
  Link as LinkIcon,
  Network,
  Search,
  Tags,
  Waves,
  type LucideIcon,
} from "lucide-react";

import type { ProjectLinkKind } from "@/lib/queries/project-site";
import { cn } from "@/lib/utils";

// lucide-react has no dedicated Figma glyph (avoiding the real logo mark
// anyway, per this file's own header comment) -- `Frame` (a bounded
// canvas/artboard shape) is the closest generic stand-in, same choice
// `portal-link-strip.tsx` made before this file existed.
const KIND_ICON: Record<ProjectLinkKind, LucideIcon> = {
  staging: FlaskConical,
  live: Globe,
  figma: Frame,
  sitemap: Network,
  drive: FolderOpen,
  webflow: Waves,
  gtm: Tags,
  analytics: BarChart3,
  search_console: Search,
  other: LinkIcon,
};

// Brand-adjacent accent colors, applied to the icon only (never the
// surrounding chrome) -- close enough to each service's own palette to
// aid quick recognition, without reproducing an actual logo mark.
const KIND_COLOR_CLASS: Record<ProjectLinkKind, string> = {
  staging: "text-amber-500",
  live: "text-emerald-600",
  figma: "text-fuchsia-500",
  sitemap: "text-sky-600",
  drive: "text-blue-600",
  webflow: "text-indigo-500",
  gtm: "text-orange-500",
  analytics: "text-violet-600",
  search_console: "text-red-500",
  other: "text-muted-foreground",
};

export function linkKindIcon(kind: ProjectLinkKind): LucideIcon {
  return KIND_ICON[kind];
}

export function linkKindColorClass(kind: ProjectLinkKind): string {
  return KIND_COLOR_CLASS[kind];
}

export function LinkKindIcon({
  kind,
  className,
}: {
  kind: ProjectLinkKind;
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <Icon
      className={cn("size-3.5", KIND_COLOR_CLASS[kind], className)}
      aria-hidden="true"
    />
  );
}
