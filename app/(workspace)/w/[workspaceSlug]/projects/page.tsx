import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceProjects, getFavoriteProjectIds } from "@/lib/queries/projects";
import { getWorkspaceProjectTemplateOptions } from "@/lib/queries/templates";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EditProjectDialog } from "@/components/edit-project-dialog";
import { ArchiveProjectDialog } from "@/components/archive-project-dialog";
import { SaveProjectAsTemplateDialog } from "@/components/save-project-as-template-dialog";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { logger } from "@/lib/observability/logger";

// F027 (AS-027, AS-034, AS-042): lists every non-deleted project in the
// active workspace. Server Component — primary content is rendered into
// the initial HTML (AS-155); the only interactive part ("New Project") is
// its own small Client Component (components/new-project-dialog.tsx).
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — reaching this
// page at all already means the caller is an active member of this
// workspace, per the clarified spec ("no duplicate page-level gate unless
// the assigned assertion specifically requires role-gating beyond
// membership" — neither AS-027 nor AS-034 nor AS-042 do).
//
// AS-042: the project list is scoped to the active workspace because
// `workspace.id` below is resolved fresh from the URL's `workspaceSlug`
// param on every request — switching workspaces via F014's switcher
// navigates to a new slug, which re-runs this Server Component with a
// different `workspace.id`, which changes the `getWorkspaceProjects(...)`
// query's `workspace_id` filter. There is no client-cached project list
// that could go stale across a switch.
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard above already redirects
  // away (via notFound()) when the workspace can't be resolved for this
  // caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  // F029 (AS-030, AS-033): the caller's own role in this workspace decides
  // whether the Archive control is even mounted for them — a plain member
  // must never see it (the server action re-checks independently, this is
  // just the UI half of defense in depth).
  const { data: callerMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const canArchive =
    callerMembership?.role === "owner" || callerMembership?.role === "admin";

  // F184: "Save as template" is a write (creates a new task_templates row)
  // — same canWrite/viewer-is-read-only gate every other mutating control
  // on this page already re-checks client-side; the server independently
  // re-checks membership + canWrite itself.
  const canSaveTemplate = callerMembership?.role !== "viewer";

  let projects: Awaited<ReturnType<typeof getWorkspaceProjects>> | null = null;
  let loadError = false;

  try {
    projects = await getWorkspaceProjects(workspace.id);
  } catch (error) {
    // Same console.error-to-Sentry convention as MembersPage — this repo
    // has no separate logging library, per tech-decisions.md.
    logger.error("ProjectsPage: failed to load projects", { error: error });
    loadError = true;
  }

  // F263 (AS-510): server-fetched alongside the project list above, same
  // "one fetch, passed down as props" convention this page already
  // follows for `projects`/`projectTemplateOptions` — not a per-card
  // client fetch.
  const favoriteProjectIds = await getFavoriteProjectIds(workspace.id);

  // F184: project-template options for the "Start from template" option
  // in the New Project dialog, server-fetched here and passed down as a
  // typed prop (clarified data-shape answer) rather than the dialog
  // querying Supabase directly.
  const projectTemplateOptions = await getWorkspaceProjectTemplateOptions(
    workspace.id,
  );

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            All projects in {workspace.name}.
          </p>
        </div>
        <NewProjectDialog
          workspaceId={workspace.id}
          templateOptions={projectTemplateOptions}
        />
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading projects. Please try again.</p>
          <a href={`/w/${workspaceSlug}/projects`} className="underline">
            Retry
          </a>
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">
            Create your first project to start organizing work.
          </p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <Link
                  href={`/w/${workspaceSlug}/projects/${project.id}/board`}
                  className="flex flex-1 flex-col gap-1.5"
                >
                  <CardTitle className="line-clamp-1">{project.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {project.description || "No description."}
                  </CardDescription>
                </Link>
                <div className="flex items-center gap-2">
                  <ProjectFavoriteButton
                    projectId={project.id}
                    projectName={project.name}
                    isFavorite={favoriteProjectIds.has(project.id)}
                  />
                  <SaveProjectAsTemplateDialog
                    projectId={project.id}
                    projectName={project.name}
                    disabled={!canSaveTemplate}
                    disabledTitle="You don't have permission to save templates."
                  />
                  <EditProjectDialog
                    workspaceId={workspace.id}
                    project={{
                      id: project.id,
                      name: project.name,
                      description: project.description,
                      startDate: project.startDate,
                      endDate: project.endDate,
                    }}
                  />
                  {canArchive && (
                    <ArchiveProjectDialog
                      workspaceId={workspace.id}
                      project={{ id: project.id, name: project.name }}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {/* AS-034: open (not "done"-category) task count,
                    batched in getWorkspaceProjects. `null` only if that
                    count query itself failed — an explicit "pending"
                    badge rather than a misleading fake 0 in that case. */}
                {project.openTaskCount === null ? (
                  <Badge variant="outline" title="Couldn't load the task count — try refreshing">
                    Open tasks: pending
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {project.openTaskCount} open task
                    {project.openTaskCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href={`/w/${workspaceSlug}`} className="underline">
          Back to workspace home
        </Link>
      </p>
    </div>
  );
}
