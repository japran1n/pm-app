import { notFound, redirect } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";

// F003b (missions/20260903-portal): "Your requests" moved to
// `p/[projectId]/requests`, inside the project-scoped shell. This file
// stays at the old `/portal/<slug>/requests` location as a redirect only
// — same reasoning and same one-project/else-chooser rule as the sibling
// left behind at `/portal/<slug>/files/page.tsx`.
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
    redirect(`/portal/${workspace.slug}/p/${projects[0].id}/requests`);
  }

  redirect(`/portal/${workspace.slug}`);
}
