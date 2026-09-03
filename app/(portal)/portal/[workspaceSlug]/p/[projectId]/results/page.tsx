import { TrendingUp } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F017+ (missions/20260903-portal, M4, before/after results) implements
// this view. F003's own scope is the shell + route stubs only — see
// PortalComingSoon.
export default function PortalResultsPage() {
  return <PortalComingSoon icon={TrendingUp} section="Results" />;
}
