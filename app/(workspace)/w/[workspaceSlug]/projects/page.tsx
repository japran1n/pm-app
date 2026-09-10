import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

import { createClient } from "@/lib/supabase/server";
import {
  getWorkspaceProjects,
  getFavoriteProjectIds,
  getProjectHealthInputs,
  type ProjectHealthQueryInput,
} from "@/lib/queries/projects";
import { computeProjectHealth } from "@/lib/projects/compute-health";
import { ProjectHealthBadge } from "@/components/projects/project-health-badge";
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

  // Perf (W9): auth and the workspace-by-slug lookup are independent of
  // each other.
  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  // Defensive fallback only — the layout guard above already redirects
  // away (via notFound()) when the workspace can't be resolved for this
  // caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  // Perf (W9): caller membership and template options each depend only on
  // `workspace.id`/`user.id` (both already known) — none depends on
  // another's result — so both run as one parallel batch. The heavier
  // project list + favourite ids fetch (W9b) is streamed in separately via
  // `<Suspense>` below so this header/controls area doesn't wait on it.
  const [{ data: callerMembership }, projectTemplateOptions] = await Promise.all([
    // F029 (AS-030, AS-033): the caller's own role in this workspace
    // decides whether the Archive control is even mounted for them — a
    // plain member must never see it (the server action re-checks
    // independently, this is just the UI half of defense in depth).
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    // F184: project-template options for the "Start from template" option
    // in the New Project dialog, server-fetched here and passed down as a
    // typed prop (clarified data-shape answer) rather than the dialog
    // querying Supabase directly.
    getWorkspaceProjectTemplateOptions(workspace.id),
  ]);

  const canArchive =
    callerMembership?.role === "owner" || callerMembership?.role === "admin";

  // F184: "Save as template" is a write (creates a new task_templates row)
  // — same canWrite/viewer-is-read-only gate every other mutating control
  // on this page already re-checks client-side; the server independently
  // re-checks membership + canWrite itself.
  const canSaveTemplate = callerMembership?.role !== "viewer";

  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            All projects in {workspace.name}.
          </p>
        </div>
        <NewProjectDialog
          workspaceId={workspace.id}
          templateOptions={projectTemplateOptions}
        />
      </div>

      {/* Perf (W9b): the project list + favourite ids fetch (and its
          per-project open-task-count batching in getWorkspaceProjects) is
          the heaviest data-dependent panel on this page, so it streams in
          separately via Suspense instead of blocking the header/New
          Project controls above. */}
      <Suspense
        fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}
      >
        <ProjectsGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          canArchive={canArchive}
          canSaveTemplate={canSaveTemplate}
        />
      </Suspense>

      <p className="text-sm text-muted-foreground">
        <Link href={`/w/${workspaceSlug}`} className="underline">
          Back to workspace home
        </Link>
      </p>
    </div>
  );
}

// Perf (W9b): extracted so the header/New Project controls above can
// stream ahead of the project list + favourite ids fetch this component
// owns — see the `<Suspense>` call site in `ProjectsPage` above for why.
export async function ProjectsGridSection({
  workspaceId,
  workspaceSlug,
  canArchive,
  canSaveTemplate,
}: {
  workspaceId: string;
  workspaceSlug: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
}) {
  // Perf (W9): the project list and favourite ids each depend only on
  // `workspaceId` (already known) — neither depends on the other's
  // result — so both run as one parallel batch. `getWorkspaceProjects`'s
  // own failure is caught individually (same try/catch semantics as
  // before) rather than letting the whole batch reject.
  const [projectsResult, favoriteProjectIds] = await Promise.all([
    getWorkspaceProjects(workspaceId).then(
      (projects) => ({ projects, error: null as unknown }),
      (error) => {
        // Same console.error-to-Sentry convention as MembersPage — this
        // repo has no separate logging library, per tech-decisions.md.
        logger.error("ProjectsPage: failed to load projects", { error: error });
        return { projects: null as Awaited<ReturnType<typeof getWorkspaceProjects>> | null, error };
      },
    ),
    // F263 (AS-510): server-fetched alongside the project list above,
    // same "one fetch, passed down as props" convention this page already
    // follows for `projects`/`projectTemplateOptions` — not a per-card
    // client fetch. `getFavoriteProjectIds` already fails open to an
    // empty Set on a query error internally, but a `.catch()` is added
    // here too (same defense-in-depth reasoning as the health-inputs
    // `.catch()` below) so that even a failure BEFORE its own internal
    // try/catch (e.g. `createClient()` itself throwing) can never reject
    // this whole `Promise.all` and take down project list rendering with
    // it — a favourites failure must only ever cost the favourite star,
    // never the page.
    getFavoriteProjectIds(workspaceId).catch((error) => {
      logger.error("ProjectsPage: failed to load favourite project ids", { error });
      return new Set<string>();
    }),
  ]);

  const projects = projectsResult.projects;
  const loadError = projectsResult.error !== null;

  // Feature request "Project health badge": one batched query for every
  // returned project's overdue-task/phase inputs, same "never per-card"
  // performance convention as `getOpenTaskCounts`/`getFavoriteProjectIds`
  // above. Best-effort: a failure here must not break the rest of the
  // page -- an empty map just makes every project's badge fall back to
  // "on_track" (nothing detected), never a thrown error.
  const healthInputsByProject: Map<string, ProjectHealthQueryInput> = projects
    ? await getProjectHealthInputs(projects.map((project) => project.id)).catch((error) => {
        logger.error("ProjectsPage: failed to load project health inputs", { error });
        return new Map<string, ProjectHealthQueryInput>();
      })
    : new Map<string, ProjectHealthQueryInput>();

  return (
    <>
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
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to start organizing work."
        />
      )}

      {projects && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="hover-lift">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <Link
                  href={`/w/${workspaceSlug}/projects/${project.id}/list`}
                  className="flex flex-1 flex-col gap-1.5"
                >
                  <CardTitle className="line-clamp-1 flex items-center gap-1.5">
                    {/* Feature request "Project ikonica/emoji": falls back
                        to the first letter of the name when no icon is
                        set, same fallback convention every other
                        project-name display in the app already uses. */}
                    <span aria-hidden="true">
                      {project.icon || project.name.charAt(0).toUpperCase()}
                    </span>
                    <span>{project.name}</span>
                  </CardTitle>
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
                    workspaceId={workspaceId}
                    project={{
                      id: project.id,
                      name: project.name,
                      description: project.description,
                      startDate: project.startDate,
                      endDate: project.endDate,
                      icon: project.icon,
                    }}
                  />
                  {canArchive && (
                    <ArchiveProjectDialog
                      workspaceId={workspaceId}
                      project={{ id: project.id, name: project.name }}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
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
                    <span className="font-mono">{project.openTaskCount}</span>{" "}
                    open task
                    {project.openTaskCount === 1 ? "" : "s"}
                  </Badge>
                )}
                {/* Feature request "Project health badge": automatic
                    on_track/at_risk/overdue rollup, computed from the
                    batched inputs fetched above. */}
                <ProjectHealthBadge
                  health={computeProjectHealth(
                    healthInputsByProject.get(project.id) ?? {
                      overdueTaskCount: 0,
                      totalTaskCount: 0,
                      currentPhase: null,
                    },
                  )}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
