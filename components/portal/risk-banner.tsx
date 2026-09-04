// F006 (missions/20260903-portal, AS-031): the overview's risk banner.
// Renders only when something is genuinely wrong -- a blocking
// deliverable past due (F012/F014, M3) or an approval open longer than
// the project's threshold (F007/F009, M2). Neither exists yet: this
// feature's own instruction is explicit that the component ships now
// and "renders nothing" until then, and that it "must not render a
// placeholder" -- there is no empty-state branch here at all, only
// `null` when `risks` is empty. `getPortalRisks` (lib/queries/portal.ts)
// is the stub that currently always supplies that empty array; this
// component's own logic does not change when a later feature gives that
// function a real body.
//
// F085 (missions/20260903-portal audit, defect 5): the sentence alone
// used to be a dead end -- it named what the item holds up, but never the
// item itself, its due date, or anywhere to go. Every row is now a Link
// to Your list (`href`, built by the caller with the workspace slug this
// query doesn't have) and states the item's own name and due date ahead
// of the sentence, so the one red banner in the whole portal is somewhere
// a client can actually act, not just read.
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { PortalRisk } from "@/lib/queries/portal";

function formatDate(iso: string): string {
  const isoWithTime = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  return new Date(isoWithTime).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function RiskBanner({
  risks,
  yourListHref,
}: {
  risks: PortalRisk[];
  /** Where a client goes to act on an outstanding item -- the Your list
   * view. Passed in rather than built here since this component has no
   * workspace slug of its own. */
  yourListHref: string;
}) {
  if (risks.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      data-testid="risk-banner"
      className="flex items-start gap-3 rounded-lg border border-status-blocked/30 bg-status-blocked-bg px-4 py-3 text-sm text-status-blocked"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <ul className="flex flex-col gap-1.5">
        {risks.map((risk) => (
          <li key={risk.id}>
            <Link
              href={yourListHref}
              data-testid="risk-banner-link"
              className="flex flex-col gap-0.5 hover:underline"
            >
              <span className="font-medium">
                {risk.itemName} · Was due {formatDate(risk.dueAt)}
              </span>
              <span>{risk.message}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
