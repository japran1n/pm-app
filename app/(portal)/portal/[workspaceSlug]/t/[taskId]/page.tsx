import { notFound, redirect } from "next/navigation";

import { getPortalTaskDetail } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";

// F003b (missions/20260903-portal): task detail moved to
// `p/[projectId]/t/[taskId]`, inside the project-scoped shell. This file
// stays at the old `/portal/<slug>/t/<taskId>` location as a redirect
// only. Unlike files/requests (which span every project, so an old link
// has to guess), a task's own project is unambiguous — `getPortalTaskDetail`
// already returns it — so this always resolves straight to the new URL
// rather than falling back to the chooser. A task that no longer resolves
// (deleted, or un-shared since the link was saved) 404s here exactly as
// it did at the old location, rather than being redirected to a page that
// would just 404 anyway.
export default async function LegacyPortalTaskRedirect({
  params,
}: {
  params: Promise<{ workspaceSlug: string; taskId: string }>;
}) {
  const { workspaceSlug, taskId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace || !user) notFound();

  const task = await getPortalTaskDetail(workspace.id, taskId, user.id);

  if (!task) notFound();

  redirect(`/portal/${workspace.slug}/p/${task.projectId}/t/${taskId}`);
}
