"use client";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { PageColumn } from "@/components/architecture/page-column";

// Mission 20260910-182104, F006 (AS-019): the Architecture board container.
// Renders one PageColumn per page in a horizontally scrolling row. The
// `components` prop is threaded through now (unused here) so later
// features (component hover highlighting, the component tray) don't need
// to change this component's public contract.
export function ArchitectureBoard({
  pages,
  components,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
}) {
  void components;

  return (
    <div className="flex min-h-0 gap-4 overflow-x-auto pb-4">
      {pages.map((page) => (
        <PageColumn key={page.id} page={page} />
      ))}
    </div>
  );
}
