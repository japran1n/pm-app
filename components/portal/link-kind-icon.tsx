// A1 (Paket A, client-portal redesign): shared brand-adjacent icon per
// `ProjectLinkKind` (lib/queries/project-site.ts), used everywhere a
// project link is rendered (`PortalLinkStrip`, `ProjectLinksList`) so the
// mapping lives in exactly one place instead of drifting between two
// generic-icon call sites.
//
// Figma and Google Drive now render their real, multi-color brand marks
// as inline SVG (per explicit user request + user-supplied Figma SVG
// geometry) -- everything else keeps the original Lucide-icon + accent-
// color treatment from Paket A, since no brand SVG was requested for
// those kinds yet.
import {
  BarChart3,
  FlaskConical,
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

type IconComponent = (props: {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) => React.JSX.Element;

// User-supplied Figma mark (5-blob geometry, viewBox 0 0 400 600) with the
// white background rect / clip-path wrapper stripped so it sits directly on
// whatever background the card uses, scaled down via width/height to match
// the other icons in this component.
function FigmaIcon({ className, ...rest }: { className?: string; "aria-hidden"?: boolean | "true" | "false" }) {
  return (
    <svg
      viewBox="0 0 400 600"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M0 500C0 444.772 44.772 400 100 400H200V500C200 555.228 155.228 600 100 600C44.772 600 0 555.228 0 500Z" fill="#24CB71" />
      <path d="M200 0V200H300C355.228 200 400 155.228 400 100C400 44.772 355.228 0 300 0H200Z" fill="#FF7237" />
      <path d="M299.167 400C354.395 400 399.167 355.228 399.167 300C399.167 244.772 354.395 200 299.167 200C243.939 200 199.167 244.772 199.167 300C199.167 355.228 243.939 400 299.167 400Z" fill="#00B6FF" />
      <path d="M0 100C0 155.228 44.772 200 100 200H200V0H100C44.772 0 0 44.772 0 100Z" fill="#FF3737" />
      <path d="M0 300C0 355.228 44.772 400 100 400H200V200H100C44.772 200 0 244.772 0 300Z" fill="#874FFF" />
    </svg>
  );
}

// Standard Google Drive tri-color mark (blue/green/yellow), well-known
// public geometry (same shape used by simple-icons' "googledrive" glyph);
// inlined by hand since `simple-icons` is not a dependency of this repo.
function DriveIcon({ className, ...rest }: { className?: string; "aria-hidden"?: boolean | "true" | "false" }) {
  return (
    <svg
      viewBox="0 0 87.3 78"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

const KIND_ICON: Record<ProjectLinkKind, LucideIcon | IconComponent> = {
  staging: FlaskConical,
  live: Globe,
  figma: FigmaIcon,
  sitemap: Network,
  drive: DriveIcon,
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

export function linkKindIcon(kind: ProjectLinkKind): LucideIcon | IconComponent {
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
