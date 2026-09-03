import { Globe } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F022+ (missions/20260903-portal, M5, site & guides) implements this
// view. F003's own scope is the shell + route stubs only — see
// PortalComingSoon.
export default function PortalSitePage() {
  return <PortalComingSoon icon={Globe} section="Your site" />;
}
