"use client";

// F030 (AS-038): the Board/List tab switcher for a project's detail
// layout. This is the smallest possible client boundary per the clarified
// spec ("thin Client Component only for the interactive part") — the
// project header and data fetch stay server-rendered in
// app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx; this
// component only wires shadcn's Tabs primitive to real URL navigation
// (each tab is a distinct route — board/page.tsx, list/page.tsx — not a
// client-side content swap), so the current tab survives a hard refresh
// and is reflected in the URL/back button.
//
// No Timeline tab, per description.md's explicit out-of-scope note and
// this feature's "Draft scope". Table is optional per tech-decisions.md
// and is not added here to avoid linking to a page that doesn't exist.
//
// W5 (docs/docs-system-plan.md) adds "Docs" as a third tab, linking to the
// project-scoped docs area at `${basePath}/docs` — same "own route, not a
// client-side content swap" rule as Board/List.

import { useRouter, usePathname } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ProjectTab = "board" | "list" | "docs";

export function ProjectTabs({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const basePath = `/w/${workspaceSlug}/projects/${projectId}`;
  // W5 (docs/docs-system-plan.md): "Docs" is a third tab, a project-scoped
  // instance of the same docs system as the workspace-level Docs area
  // (W3/W4) — checked first since `${basePath}/docs` doesn't overlap with
  // `${basePath}/list` or the board route.
  const activeTab: ProjectTab = pathname?.startsWith(`${basePath}/docs`)
    ? "docs"
    : pathname?.startsWith(`${basePath}/list`)
    ? "list"
    : "board";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        router.push(`${basePath}/${value}`);
      }}
    >
      <TabsList>
        <TabsTrigger value="board">Board</TabsTrigger>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="docs">Docs</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
