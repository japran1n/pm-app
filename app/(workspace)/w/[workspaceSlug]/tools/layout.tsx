import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canReadSitemaps } from "@/lib/auth/permissions";

// Route guard for every /w/[workspaceSlug]/tools/* page. The Tools are team
// tools: guests and clients have none (404, same as any route they can't
// reach). Viewers pass this layout because the Sitemap Builder is
// team-readable incl. viewers; the converter and code editor add their own
// team-only layouts below this one. The sidebar's Tools band uses the same
// predicates (canReadSitemaps / canUseTeamTools).
export default async function ToolsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);
  if (!ctx.workspace || !ctx.role || !canReadSitemaps({ role: ctx.role })) {
    notFound();
  }
  return <>{children}</>;
}
