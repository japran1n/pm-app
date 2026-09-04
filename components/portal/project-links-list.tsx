// F023 (missions/20260903-portal, AS-049): the "Links" section of the
// portal's "Your site" view. `links` has already been through
// `getProjectLinks` (RLS-scoped) -- this component never applies its own
// `clientVisible` filter, matching the read side's own convention that
// RLS is the one visibility boundary (lib/queries/project-site.ts's own
// header comment).
//
// Every link opens in a new tab with rel="noopener noreferrer" (this
// view's own "external links leave the portal" note), and shows its
// destination as a muted mono label before the client clicks --
// `new URL(url).hostname`, not the raw URL, so a long query string or
// path doesn't dominate the row; falls back to the raw string if the URL
// somehow fails to parse (never throw rendering a list).
import { ExternalLink } from "lucide-react";

import type { ProjectLink, ProjectLinkKind } from "@/lib/queries/project-site";
import { EmptyState } from "@/components/empty-state";

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
    <ul className="flex flex-col gap-2" data-testid="project-links-list">
      {links.map((link) => (
        <li key={link.id} className="rounded-md border border-border p-3">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-wrap items-center justify-between gap-2 hover:underline"
            data-testid="project-link-row"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {link.label}
                <span className="rounded bg-muted px-1.5 py-0.5 text-tag text-muted-foreground">
                  {KIND_LABEL[link.kind]}
                </span>
              </span>
              <span className="truncate font-mono text-tag text-muted-foreground">
                {hostLabel(link.url)}
              </span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
