import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canUseTeamTools } from "@/lib/auth/permissions";

// Team-only tool: owner/admin/member (canUseTeamTools). A viewer passes
// tools/layout.tsx (for the Sitemap Builder) but not this one.
export default async function TeamToolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);
  if (!ctx.workspace || !ctx.role || !canUseTeamTools({ role: ctx.role })) {
    notFound();
  }
  return <>{children}</>;
}
