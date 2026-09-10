import { getArchitectureBoard } from "@/lib/queries/architecture";
import { ArchitectureBoardEmptyState } from "@/components/architecture/board-empty-state";
import { ArchitectureBoard } from "@/components/architecture/board";

// Mission 20260910-182104, F005 (AS-028, AS-030): the Architecture tab's
// route. Server Component, same pattern as the sibling
// projects/[projectId]/board/page.tsx -- data fetched here via F004's
// getArchitectureBoard(projectId) (unfiltered, team-side read), branching
// to the empty state when the project has zero pages.
//
// Access relies on the project detail layout's guard one level up
// (workspace membership) plus getProjectById's cross-workspace 404
// handling, same as every other project detail tab -- no duplicate
// page-level gate here.
//
// The non-empty branch renders a placeholder <div> only. F006+ replaces
// this with the real <ArchitectureBoard> drag/drop component once that
// lands; this feature's scope is the route, tab, and empty state only.
export default async function ProjectArchitecturePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const result = await getArchitectureBoard(projectId);
  const board = result.ok ? result.data : { pages: [], components: [] };

  if (board.pages.length === 0) {
    return <ArchitectureBoardEmptyState />;
  }

  return <ArchitectureBoard pages={board.pages} components={board.components} />;
}
