import { Clock } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F017+ (missions/20260903-portal, M4, hours burn-down) implements this
// view. F003's own scope is the shell + route stubs only — see
// PortalComingSoon.
export default function PortalHoursPage() {
  return <PortalComingSoon icon={Clock} section="Hours" />;
}
