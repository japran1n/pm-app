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
import { AlertTriangle } from "lucide-react";

import type { PortalRisk } from "@/lib/queries/portal";

export function RiskBanner({ risks }: { risks: PortalRisk[] }) {
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
      <ul className="flex flex-col gap-1">
        {risks.map((risk) => (
          <li key={risk.id}>{risk.message}</li>
        ))}
      </ul>
    </div>
  );
}
