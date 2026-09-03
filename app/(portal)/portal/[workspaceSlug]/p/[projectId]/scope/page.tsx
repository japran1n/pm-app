import { ScrollText } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F012+ (missions/20260903-portal, M3, scope & decisions) implements
// this view. F003's own scope is the shell + route stubs only — see
// PortalComingSoon.
export default function PortalScopePage() {
  return <PortalComingSoon icon={ScrollText} section="Scope & decisions" />;
}
