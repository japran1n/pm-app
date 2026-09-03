import { ListChecks } from "lucide-react";

import { PortalComingSoon } from "@/components/portal/portal-coming-soon";

// F012+ (missions/20260903-portal, M3, client obligations) implements
// this view. F003's own scope is the shell + route stubs only — see
// PortalComingSoon.
export default function PortalYourListPage() {
  return <PortalComingSoon icon={ListChecks} section="Your list" />;
}
