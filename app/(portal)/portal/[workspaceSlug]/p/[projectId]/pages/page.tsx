import { FileText } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F005 (missions/20260903-portal, M1) implements this view. F003's own
// scope is the shell + route stubs only — see PortalComingSoon.
export default function PortalPagesPage() {
  return <PortalComingSoon icon={FileText} section="Pages" />;
}
