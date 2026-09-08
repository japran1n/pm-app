// Internal (workspace) "quick links" strip: the same fast-access pattern
// the portal already gives the client (PortalLinkStrip -- Figma, staging,
// live site, always in the same place) but for the team side, and for
// EVERY link kind the project has (not just the three "client checks
// constantly" kinds the portal strip narrows to), since the team's full
// list already lives one click away in Settings -> Site
// (components/project/site-panel.tsx / project-links-list) and this strip
// is meant to spare that click on the pages the team actually works from
// (board/list), not to duplicate a curated subset.
//
// Rendered from the project detail layout
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx) so
// it shows up above every tab (board, list, hours, docs, settings), not
// just one of them -- "visible on the main project pages, not just buried
// in settings" per this feature's own brief.
//
// Reuses `LinkKindIcon` (components/shared/link-kind-icon.tsx) for the
// same brand-adjacent icon treatment the portal already uses, so a Figma
// or Drive link is recognisable at a glance in both places.
import { ExternalLink } from "lucide-react";

import type { ProjectLink } from "@/lib/queries/project-site";
import { LinkKindIcon } from "@/components/shared/link-kind-icon";

const KIND_LABEL: Record<ProjectLink["kind"], string> = {
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

export function ProjectLinkStrip({ links }: { links: ProjectLink[] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="project-link-strip"
      aria-label="Project links"
    >
      {links.map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`project-link-strip-${link.kind}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-micro font-medium text-foreground hover-surface"
          title={link.label || KIND_LABEL[link.kind]}
        >
          <LinkKindIcon kind={link.kind} />
          {link.label || KIND_LABEL[link.kind]}
          <ExternalLink className="size-3 text-muted-foreground" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}
