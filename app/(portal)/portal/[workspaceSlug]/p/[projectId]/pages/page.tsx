import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { getPortalPages, getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { StatusDistribution } from "@/components/portal/status-distribution";
import { PagesTable } from "@/components/portal/pages-table";
import { PageTravelStrip } from "@/components/portal/page-travel-strip";
import type { ClientBucket } from "@/components/portal/status-label";

// F005 (missions/20260903-portal, AS-014, AS-016, AS-017, AS-018): the
// Pages view — replaces F003's `PortalComingSoon` stub.
//
// The project is re-resolved here via `getPortalProjects` (not trusted
// from the URL alone), same "one visibility path, not two" convention
// `p/[projectId]/page.tsx` (the Overview route) already documents on
// itself — the enclosing layout already 404s for an unshared/
// portal-disabled project, this is what makes the route independently
// correct even reached directly.
export default async function PortalPagesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  const pages = await getPortalPages(projectId);

  if (pages.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No pages have been shared with you yet."
        description="Once the team shares a page from this project, it will show up here."
        testId="pages-view-empty"
      />
    );
  }

  // AS-017: the distribution bar's counts — every bucket, always present
  // (even at 0), computed once here from the same rows the table below
  // renders, never a second query.
  const counts: Record<ClientBucket, number> = {
    waiting: 0,
    progress: 0,
    blocked: 0,
    done: 0,
  };
  for (const page of pages) {
    counts[page.status.clientBucket] += 1;
  }

  return (
    <div className="flex flex-col gap-8">
      <StatusDistribution counts={counts} />
      <PagesTable pages={pages} />
      <PageTravelStrip />
    </div>
  );
}
