import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { Archive, FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import {
  getWorkspaceProjects,
  getFavoriteProjectIds,
  getProjectHealthInputs,
  getProjectTeamPreview,
  getArchivedWorkspaceProjects,
  type ProjectHealthQueryInput,
} from "@/lib/queries/projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ArchivedProjectCard } from "@/components/projects/archived-project-card";
import { getWorkspaceProjectTemplateOptions } from "@/lib/queries/templates";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
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
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const filterParam = Array.isArray(resolvedSearchParams.filter)
    ? resolvedSearchParams.filter[0]
    : resolvedSearchParams.filter;

  // ARCH-001: caller identity, the workspace-by-slug lookup, and the
  // caller's own membership role all come from the shared cached helper
  // (lib/queries/workspaces.ts) instead of three per-page queries.
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.user) {
    redirect("/sign-in");
  }

  // Defensive fallback only — the layout guard above already redirects
  // away (via notFound()) when the workspace can't be resolved for this
  // caller.
  if (!ctx.workspace) {
    redirect("/onboarding");
  }

  const { workspace, role } = ctx;

  // F012 (SB-045, SB-046): `?filter=archived` shows every archived
  // (soft-deleted) project in this workspace instead of the default
  // active list — same view the standalone /archive route used to own
  // (F142), now folded into this page so there's a single "Projects"
  // surface with a filter rather than two separate pages. A guest never
  // gets the archived view — same page-level gate the old /archive page
  // enforced (workspace-wide history is not part of a guest's
  // project-scoped access) — falling back to the default active list
  // instead of a hard redirect, since this is just a query-param switch
  // on a page guests are otherwise allowed to view.
  const isArchivedView = filterParam === "archived" && role !== "guest";

  // Perf (W9): caller membership and template options each depend only on
  // `workspace.id`/`user.id` (both already known) — none depends on
  // another's result — so both run as one parallel batch. The heavier
  // project list + favourite ids fetch (W9b) is streamed in separately via
  // `<Suspense>` below so this header/controls area doesn't wait on it.
  // F184: project-template options for the "Start from template" option
  // in the New Project dialog, server-fetched here and passed down as a
  // typed prop (clarified data-shape answer) rather than the dialog
  // querying Supabase directly. Skipped entirely for the archived view —
  // "New Project" isn't offered there.
  const projectTemplateOptions = isArchivedView
    ? []
    : await getWorkspaceProjectTemplateOptions(workspace.id);

  // F029 (AS-030, AS-033): the caller's own role in this workspace
  // decides whether the Archive control is even mounted for them — a
  // plain member must never see it (the server action re-checks
  // independently, this is just the UI half of defense in depth).
  const canArchive = role === "owner" || role === "admin";

  // F184: "Save as template" is a write (creates a new task_templates row)
  // — same canWrite/viewer-is-read-only gate every other mutating control
  // on this page already re-checks client-side; the server independently
  // re-checks membership + canWrite itself.
  const canSaveTemplate = role !== "viewer";

  // F143 (AS-252, AS-253): restore control on the archived view, admin/
  // owner only — same gate the old /archive page used.
  const canRestore = role === "owner" || role === "admin";

  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {isArchivedView
              ? `Projects archived from ${workspace.name}. Archiving hides a project from the active list without deleting its data.`
              : `All projects in ${workspace.name}.`}
          </p>
        </div>
        {/* F010 (PL-040): toolbar row — search (placeholder, F011), view
            toggle (placeholder, F012) and New Project. Only rendered for
            the active view — "New Project" isn't offered on the archived
            view, same as before this feature. */}
        {!isArchivedView && (
          <ProjectsToolbar
            workspaceId={workspace.id}
            templateOptions={projectTemplateOptions}
          />
        )}
      </div>

      {/* F012 (SB-045): filter control — Active is the default (no query
          param, matching this page's pre-existing bookmarked/linked URL),
          Archived is only offered to non-guests (see `isArchivedView`
          above). */}
      {role !== "guest" && (
        <div className="flex items-center gap-1 border-b">
          <Link
            href={`/w/${workspaceSlug}/projects`}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${
              isArchivedView
                ? "border-transparent text-muted-foreground hover:text-foreground"
                : "border-primary text-foreground"
            }`}
          >
            Active
          </Link>
          <Link
            href={`/w/${workspaceSlug}/projects?filter=archived`}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${
              isArchivedView
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Archived
          </Link>
        </div>
      )}

      {/* Perf (W9b): the project list + favourite ids fetch (and its
          per-project open-task-count batching in getWorkspaceProjects) is
          the heaviest data-dependent panel on this page, so it streams in
          separately via Suspense instead of blocking the header/New
          Project controls above. */}
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {/* F009 (PL-031): three-zone skeleton (top zone, inner panel,
                footer row) mirroring components/projects/project-card.tsx,
                same shape as app/(workspace)/w/[workspaceSlug]/projects/loading.tsx
                so the Suspense boundary and the route's loading.tsx never
                visibly disagree. */}
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="flex h-full animate-pulse flex-col gap-3 rounded-md border bg-card p-4 shadow-xs"
              >
                <div className="flex items-start gap-3">
                  <div className="size-9 shrink-0 rounded-md bg-muted" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="h-1.5 w-full rounded-full bg-muted" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="h-6 w-16 rounded-full bg-muted" />
                  <div className="h-3 w-12 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        }
      >
        {isArchivedView ? (
          <ArchivedProjectsSection
            workspaceId={workspace.id}
            workspaceSlug={workspaceSlug}
            canRestore={canRestore}
          />
        ) : (
          <ProjectsGridSection
            workspaceId={workspace.id}
            workspaceSlug={workspaceSlug}
            canArchive={canArchive}
            canSaveTemplate={canSaveTemplate}
          />
        )}
      </Suspense>
    </div>
  );
}

// F012 (SB-045, SB-046): the archived-projects view, folded in from the
// old standalone /archive page (F142/F143) — same query
// (`getArchivedWorkspaceProjects`), same empty state, and same
// admin/owner-only restore control, now rendered when `?filter=archived`
// is present instead of on its own route.
export async function ArchivedProjectsSection({
  workspaceId,
  workspaceSlug,
  canRestore,
}: {
  workspaceId: string;
  workspaceSlug: string;
  canRestore: boolean;
}) {
  let archivedProjects: Awaited<
    ReturnType<typeof getArchivedWorkspaceProjects>
  > | null = null;
  let loadError = false;

  try {
    archivedProjects = await getArchivedWorkspaceProjects(workspaceId);
  } catch (error) {
    logger.error("ProjectsPage (archived filter): failed to load archived projects", {
      error,
    });
    loadError = true;
  }

  return (
    <>
      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading the archive. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/projects?filter=archived`}
            className="underline"
          >
            Retry
          </a>
        </div>
      )}

      {archivedProjects && archivedProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <Archive className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">No archived projects</p>
            <p className="text-sm text-muted-foreground">
              Projects you archive from the project list will show up here,
              along with when they were archived and by whom.
            </p>
          </div>
        </div>
      )}

      {archivedProjects && archivedProjects.length > 0 && (
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {archivedProjects.map((project) => (
            <ArchivedProjectCard
              key={project.id}
              project={project}
              workspaceId={workspaceId}
              canRestore={canRestore}
            />
          ))}
        </div>
      )}
    </>
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

  // PL-012: fails open -- an error yields an empty team preview.
  const teamPreviewByProject = projects
    ? await getProjectTeamPreview(projects.map((project) => project.id)).catch((error) => {
        logger.error("ProjectsPage: failed to load project team preview", { error });
        return new Map<string, Awaited<ReturnType<typeof getProjectTeamPreview>> extends Map<string, infer V> ? V : never>();
      })
    : new Map();

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
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {projects.map((project) => {
            const healthInput = healthInputsByProject.get(project.id) ?? {
              overdueTaskCount: 0,
              totalTaskCount: 0,
              doneTaskCount: 0,
              currentPhase: null,
            };
            const isFavorite = favoriteProjectIds.has(project.id);

            return (
              <ProjectCard
                key={project.id}
                project={project}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                canArchive={canArchive}
                canSaveTemplate={canSaveTemplate}
                isFavorite={isFavorite}
                healthInput={healthInput}
                teamPreview={teamPreviewByProject.get(project.id)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
