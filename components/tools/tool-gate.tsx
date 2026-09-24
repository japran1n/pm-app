"use client";

import type { ReactNode } from "react";

import { useMembership } from "@/components/auth/membership-provider";
import { canReadSitemaps, canUseTeamTools } from "@/lib/auth/permissions";

export type ToolAccess = "team" | "sitemaps";

// Hides a Tools-index card from a role that can't use that tool, with the
// same predicates as the sidebar's Tools band and the tools/** route
// layouts (which are the real gate): "team" tools (converter, code editor)
// are owner/admin/member only, "sitemaps" is also readable by viewers.
// No MembershipProvider in the tree (isolated tests) renders the card.
export function ToolGate({
  access,
  children,
}: {
  access: ToolAccess;
  children: ReactNode;
}) {
  const membership = useMembership();
  if (!membership) return <>{children}</>;
  const allowed =
    access === "team"
      ? canUseTeamTools({ role: membership.role })
      : canReadSitemaps({ role: membership.role });
  return allowed ? <>{children}</> : null;
}
