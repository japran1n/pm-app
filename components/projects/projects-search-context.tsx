"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

// F011 (PL-041): the search query needs to be readable from TWO places
// that can't share ordinary React props — `ProjectsToolbar` (rendered
// synchronously in the page header, ahead of the Suspense boundary, per
// F010/PL-040's perf convention) and the project grid (rendered inside
// that Suspense boundary, after the server-fetched project list
// resolves). A `useState` living in a shared client Provider above both
// gives each side a stable, local-state-backed query without forcing the
// toolbar to wait on the data fetch (which would regress F010's
// pre-existing "toolbar renders immediately" behaviour) and without
// resorting to a URL param (the clarified pattern calls for local
// `useState`, not routing).
type ProjectsSearchContextValue = {
  query: string;
  setQuery: (value: string) => void;
};

const ProjectsSearchContext = createContext<ProjectsSearchContextValue | null>(
  null,
);

export function ProjectsSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return (
    <ProjectsSearchContext.Provider value={{ query, setQuery }}>
      {children}
    </ProjectsSearchContext.Provider>
  );
}

// `null` outside a provider (e.g. the archived view, which never mounts
// `ProjectsSearchProvider`) — callers treat that as "search not offered
// here" rather than throwing.
export function useProjectsSearch(): ProjectsSearchContextValue | null {
  return useContext(ProjectsSearchContext);
}

// Header-side connector: reads the query out of context and hands it to
// `ProjectsToolbar` (kept prop-driven, not a hook consumer itself, so it
// stays trivially callable/testable as a plain function — see
// tests/unit/f010-projects-toolbar.test.tsx, which invokes it directly
// outside of a render tree).
export function ProjectsToolbarWithSearch({
  workspaceId,
  templateOptions,
}: {
  workspaceId: string;
  templateOptions: TaskTemplatePickerOption[];
}) {
  const search = useProjectsSearch();
  return (
    <ProjectsToolbar
      workspaceId={workspaceId}
      templateOptions={templateOptions}
      searchValue={search?.query}
      onSearchChange={search?.setQuery}
    />
  );
}
