import { CheckCircle2 } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F009 (missions/20260903-portal, M2) implements this view. F003's own
// scope is the shell + route stubs only — see PortalComingSoon.
export default function PortalApprovalsPage() {
  return <PortalComingSoon icon={CheckCircle2} section="Approvals" />;
}
