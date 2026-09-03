import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

// F003 (missions/20260903-portal, "Route stubs"): the one honest empty
// state every not-yet-built view (Approvals, Your list, Pages, Hours,
// Results, Scope & decisions, Your site) renders instead of a 404 or
// fake data, per this feature's own spec section 4 ("Anything not yet
// implemented renders EmptyState with honest copy... never a 404 and
// never fake data"). A single shared component so all seven stubs use
// the exact same copy shape rather than each inventing its own wording —
// the next feature that implements one of these views deletes this
// import from that one route and nothing else changes.
export function PortalComingSoon({
  icon,
  section,
}: {
  icon: LucideIcon;
  section: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title="Coming in this project"
      description={`${section} isn't wired up yet — it arrives with a future release.`}
    />
  );
}
