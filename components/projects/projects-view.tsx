"use client";

import { useMemo } from "react";
import { FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectListTable } from "@/components/projects/project-list-table";
import { useProjectsSearch } from "@/components/projects/projects-search-context";
import type {
  ProjectHealthQueryInput,
  ProjectListItem,
  ProjectTeamPreview,
} from "@/lib/queries/projects";

// F011 (PL-041): one serializable view model per card — everything
// ProjectCard needs, already resolved server-side (F009/PL-012/PL-013),
// so this client component never re-fetches anything of its own. Plain
// data (no functions), safe to pass across the Server → Client boundary.
export type ProjectsViewItem = {
  project: ProjectListItem;
  healthInput: ProjectHealthQueryInput;
  isFavorite: boolean;
  teamPreview?: ProjectTeamPreview;
};

// F011 (PL-041): client wrapper that filters the server-serialized
// `items` array in-memory — case-insensitive match on project name OR
// the project's current phase name. The search query itself is
// `useState` living in `ProjectsSearchProvider` (see
// components/projects/projects-search-context.tsx): it has to sit ABOVE
// both this component (which needs the loaded project list to filter
// against, so it only mounts once the F009/PL-031 Suspense boundary
// resolves) and `ProjectsToolbar`'s search input (which renders
// synchronously in the page header, ahead of that same boundary, per
// F010/PL-040's pre-existing "toolbar renders immediately" perf
// convention) — a plain `useState` local to just this component can't
// reach the header's input, and vice versa.
//
// Not used for the archived view (F012/SB-045) — the clarified spec
// explicitly scopes search to the active list only; `ProjectsSearchProvider`
// is never mounted there, so `useProjectsSearch()` returns `null` and this
// component simply isn't rendered.
export function ProjectsView({
  items,
  workspaceId,
  workspaceSlug,
  canArchive,
  canSaveTemplate,
  view = "grid",
}: {
  items: ProjectsViewItem[];
  workspaceId: string;
  workspaceSlug: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
  // F013 (PL-042, PL-044): which layout to render — same filtered
  // `filteredItems`/empty-state logic below is shared between grid and
  // list, only the final render branches.
  view?: "grid" | "list";
}) {
  const search = useProjectsSearch();
  const trimmedQuery = (search?.query ?? "").trim();

  const filteredItems = useMemo(() => {
    if (!trimmedQuery) return items;
    const needle = trimmedQuery.toLowerCase();
    return items.filter(({ project, healthInput }) => {
      const name = project.name.toLowerCase();
      const phaseName = (healthInput.currentPhase?.name ?? "").toLowerCase();
      return name.includes(needle) || phaseName.includes(needle);
    });
  }, [items, trimmedQuery]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        description="Create your first project to start organizing work."
      />
    );
  }

  if (filteredItems.length === 0) {
    // PL-041: empty state shown when the search query matches nothing —
    // quotes the exact query text back to the user.
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No projects match &ldquo;{trimmedQuery}&rdquo;
        </p>
      </div>
    );
  }

  if (view === "list") {
    // F013 (PL-043, PL-044): list view — same `filteredItems`, same
    // favourite/actions/empty/error parity, just table rows instead of
    // cards.
    return (
      <ProjectListTable
        items={filteredItems}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        canArchive={canArchive}
        canSaveTemplate={canSaveTemplate}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {filteredItems.map(({ project, healthInput, isFavorite, teamPreview }) => (
        <ProjectCard
          key={project.id}
          project={project}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          canArchive={canArchive}
          canSaveTemplate={canSaveTemplate}
          isFavorite={isFavorite}
          healthInput={healthInput}
          teamPreview={teamPreview}
        />
      ))}
    </div>
  );
}
