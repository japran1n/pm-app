// Fix ("Your site" Guides section empty / F114 doc_links reuse): the
// title/description/thumbnail preview card grid for a doc's `doc_links`
// rows -- originally written inline inside `how-we-work-list.tsx`
// (F114) for the "How we work" section's handover walkthroughs. Pulled
// out unchanged so `project-guides-list.tsx`'s Guides section (which now
// also surfaces `portal_guide`/`handover` docs alongside `training`, see
// that file's own header comment) can render the same link cards without
// duplicating this markup -- "reuse existing how-we-work query/components
// for links where possible rather than duplicating."
import { ExternalLink } from "lucide-react";

import type { DocLink } from "@/lib/queries/docs";

export function DocLinksGrid({ links }: { links: DocLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="doc-links-grid">
      {links.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover-surface flex flex-col gap-1 rounded-md border border-border p-3"
            data-testid="doc-link-card"
          >
            {link.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- an arbitrary, untrusted external URL a team member typed in manually; not a locally-optimizable asset.
              <img
                src={link.thumbnailUrl}
                alt=""
                className="h-28 w-full rounded object-cover"
              />
            )}
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {link.title}
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            {link.description && (
              <span className="line-clamp-2 text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                {link.description}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
