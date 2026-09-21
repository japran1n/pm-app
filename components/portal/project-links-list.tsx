// F023 (missions/20260903-portal, AS-049): the "Links" section of the
// portal's "Your site" view. `links` has already been through
// `getClientVisiblePortalLinks` (F025e; RLS-scoped and explicitly
// filtered to client_visible = true) -- this component never applies its
// own `clientVisible` filter, matching the read side's own convention
// (lib/queries/project-site.ts's own header comment).
//
// Every link opens in a new tab with rel="noopener noreferrer" (this
// view's own "external links leave the portal" note), and shows its
// destination as a muted mono label before the client clicks --
// `new URL(url).hostname`, not the raw URL, so a long query string or
// path doesn't dominate the row; falls back to the raw string if the URL
// somehow fails to parse (never throw rendering a list).
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// rendered as a grid of clickable cards (matching `team-card.tsx`'s
// border/radius/spacing conventions) rather than a plain list, with the
// `LinkKindIcon` scaled up as the card's visual anchor -- same data,
// same empty state, purely a markup/visual change.
//
// Follow-up polish request ("Links kartice - kreativniji vizuelni dizajn"):
// each icon now sits in a brand-tinted badge (matching the same
// `LinkKindIcon` accent color, just applied as a soft background instead of
// only the glyph color), the card lifts/scales slightly on hover, and a
// contextual "Opens in <service>" line was added under the label -- there's
// no "last updated" data on `ProjectLink` (see the type below), so that half
// of the ask is deliberately not invented.
import { ExternalLink } from "lucide-react";

import type { ProjectLink, ProjectLinkKind } from "@/lib/queries/project-site";
import { EmptyState } from "@/components/empty-state";
import { LinkKindIcon } from "@/components/shared/link-kind-icon";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ProjectLinkKind, string> = {
  staging: "Staging",
  live: "Live site",
  figma: "Figma",
  sitemap: "Sitemap",
  drive: "Drive",
  webflow: "Webflow",
  gtm: "Tag manager",
  analytics: "Analytics",
  search_console: "Search console",
  other: "Other",
};

// Soft, brand-adjacent badge backgrounds behind each icon -- same hue family
// as `linkKindColorClass` in link-kind-icon.tsx, just a tint instead of a
// solid glyph color, so the icon reads as a small "chip" rather than a bare
// glyph floating on the card.
const KIND_BADGE_CLASS: Record<ProjectLinkKind, string> = {
  staging: "bg-amber-500/10",
  live: "bg-emerald-600/10",
  figma: "bg-fuchsia-500/10",
  sitemap: "bg-sky-600/10",
  drive: "bg-blue-600/10",
  webflow: "bg-indigo-500/10",
  gtm: "bg-orange-500/10",
  analytics: "bg-violet-600/10",
  search_console: "bg-red-500/10",
  other: "bg-muted",
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ProjectLinksList({ links }: { links: ProjectLink[] }) {
  if (links.length === 0) {
    return (
      <EmptyState
        icon={ExternalLink}
        title="No links shared yet."
        description="Staging, live, and other project links will show up here once the team shares them."
        testId="project-links-empty"
      />
    );
  }

  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="project-links-list"
    >
      {links.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover-surface group flex h-full flex-col gap-3 rounded-lg border border-border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:scale-[1.02]"
            data-testid="project-link-row"
          >
            <span className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105",
                  KIND_BADGE_CLASS[link.kind],
                )}
              >
                <LinkKindIcon kind={link.kind} className="size-6" />
              </span>
              <ExternalLink
                className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {link.label}
              </span>
              <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                {KIND_LABEL[link.kind]}
              </span>
              <span className="truncate font-mono text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                {hostLabel(link.url)}
              </span>
              <span className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground/80">
                Opens in {KIND_LABEL[link.kind]}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
