import { notFound, redirect } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";

// F003b (missions/20260903-portal): "Files" moved to
// `p/[projectId]/files`, inside the project-scoped shell. This file stays
// at the old `/portal/<slug>/files` location purely so a stale bookmark
// or a client's yesterday-open tab does not 404 -- it resolves the
// client's own portal-enabled project(s) and forwards them: straight into
// the one project's files view when there is exactly one (the common
// case, and the same "skip the chooser" rule `[workspaceSlug]/page.tsx`
// already applies), or to the project chooser when there are zero or
// several and picking one for the client would be a guess.
export default async function LegacyPortalFilesRedirect({
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
    redirect(`/portal/${workspace.slug}/p/${projects[0].id}/files`);
  }

  redirect(`/portal/${workspace.slug}`);
}
