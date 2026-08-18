import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/queries/projects";
import { ProjectTabs } from "@/components/project-tabs";
import { Badge } from "@/components/ui/badge";

// F030 (AS-038): project detail layout — resolves the project scoped to
// the active workspace, renders a header (name/description, plus an
// "Archived" indicator per F029/AS-032) and the Board/List tab switcher,
// then renders whichever tab route (board/page.tsx or list/page.tsx) is
// active as `children`.
//
// Server Component (clarified spec: "Server Component for data-fetching,
// thin Client Component only for the interactive part") — the only client
// boundary is ProjectTabs, which just wires the tab switcher to real
// navigation. Header content is server-rendered in the initial HTML
// (AS-155).
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — reaching
// this layout at all already means the caller is an active member of this
// workspace. No duplicate page-level gate, per the clarified spec, since
// AS-038 doesn't call for role-gating beyond membership.
//
// Works for both active and archived projects (per F029/AS-032, and this
// feature's own spec): `getProjectById` (lib/queries/projects.ts)
// deliberately bypasses the RLS SELECT policy's `deleted_at IS NULL`
// filter via the admin client, so an archived project's detail page
// renders normally instead of 404ing — AS-032 requires the row's data stay
// fully intact and readable, and this is the first UI surface that reads a
// project by id directly rather than through the always-filtered list
// query.
export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // RLS-backed lookup (`workspaces_select_active_members`) — a null result
  // here means either the workspace doesn't exist or the caller isn't an
  // active member, both of which the layout guard above already redirects
  // away from; this is a defensive fallback only.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect("/onboarding");
  }

  const project = await getProjectById(workspace.id, projectId);

  // A projectId that doesn't exist, or belongs to a different workspace,
  // is a genuine 404 — not distinguishing "doesn't exist" from "wrong
  // workspace" avoids leaking cross-workspace existence, mirroring the
  // workspace layout's own AS-144 rationale.
  if (!project) {
    notFound();
  }

  const isArchived = Boolean(project.deletedAt);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{project.name}</h1>
              {isArchived && <Badge variant="outline">Archived</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {project.description || "No description."}
            </p>
          </div>
          <Link
            href={`/w/${workspaceSlug}/projects`}
            className="text-sm text-muted-foreground underline"
          >
            Back to projects
          </Link>
        </div>

        <ProjectTabs workspaceSlug={workspaceSlug} projectId={project.id} />
      </div>

      {children}
    </div>
  );
}
