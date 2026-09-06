// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// the project-level "fixed strip" — Figma, staging, live, always in the
// same place across every portal route. Placed in the sticky topbar
// (`PortalTopbar`, rendered on all eleven routes under the portal shell)
// rather than only inside "Your site": a client checking the staging URL
// mid-review, from Approvals or Pages, should not have to navigate away
// first. "Your site" remains the durable home for the full links list
// (including sitemap/drive/analytics/etc, F022/F023) — this strip is
// only the three links a client opens constantly, argued in this
// feature's own spec.
//
// The live slot always renders, even with no live link yet: "before
// launch its slot should say something honest rather than being absent
// without explanation" (this feature's own spec) — an unlabeled gap
// where "Live" should be reads as a broken page, not as "not launched
// yet". Figma/staging slots are omitted entirely when absent — unlike
// live, there's no launch-relative honesty question for a link that
// simply hasn't been shared yet.
import { ExternalLink } from "lucide-react";

import { LinkKindIcon } from "@/components/portal/link-kind-icon";

export type PortalKeyLink = {
  kind: "figma" | "staging" | "live";
  label: string;
  url: string;
};

const KIND_LABEL: Record<PortalKeyLink["kind"], string> = {
  figma: "Figma",
  staging: "Staging",
  live: "Live site",
};

function LinkChip({ kind, url }: { kind: PortalKeyLink["kind"]; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`portal-link-strip-${kind}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover-surface"
    >
      <LinkKindIcon kind={kind} />
      {KIND_LABEL[kind]}
    </a>
  );
}

export function PortalLinkStrip({ links }: { links: PortalKeyLink[] }) {
  const figma = links.find((l) => l.kind === "figma");
  const staging = links.find((l) => l.kind === "staging");
  const live = links.find((l) => l.kind === "live");

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="portal-link-strip">
      {figma && <LinkChip kind="figma" url={figma.url} />}
      {staging && <LinkChip kind="staging" url={staging.url} />}
      {live ? (
        <LinkChip kind="live" url={live.url} />
      ) : (
        <span
          data-testid="portal-link-strip-live-pending"
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"
          title="The live site link will appear here once the project has launched."
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Not live yet
        </span>
      )}
    </div>
  );
}
