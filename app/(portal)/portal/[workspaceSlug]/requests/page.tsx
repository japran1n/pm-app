import { notFound, redirect } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";

// F003b (missions/20260903-portal): "Your requests" moved to
// `p/[projectId]/requests`, inside the project-scoped shell. This file
// stays at the old `/portal/<slug>/requests` location as a redirect only
// — same reasoning and same one-project/else-chooser rule as the sibling
// left behind at `/portal/<slug>/files/page.tsx`.
//
// Mission 20260914-portal-simplify, F009 (AS-017): the project-scoped
// destination is now `p/[projectId]/conversation` ("Messages", which
// folds requests in — F007), not `p/[projectId]/requests` (itself now a
// redirect, see that file's own comment).
export default async function LegacyPortalRequestsRedirect({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const projects = await getPortalProjects(workspace.id);

  if (projects.length === 1) {
    redirect(`/portal/${workspace.slug}/p/${projects[0].id}/conversation`);
  }

  redirect(`/portal/${workspace.slug}`);
}
