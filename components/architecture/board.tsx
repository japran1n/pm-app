"use client";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { PageColumn } from "@/components/architecture/page-column";

// Mission 20260910-182104, F006 (AS-019): the Architecture board container.
// Renders one PageColumn per page in a horizontally scrolling row. The
// `components` prop is threaded through now (unused here) so later
// features (component hover highlighting, the component tray) don't need
// to change this component's public contract.
// F009 (AS-027): this same div is both the flex row and the scroll
// container -- `overflow-x-auto` clips it to the viewport width and the
// browser draws a horizontal scrollbar once the fixed-width PageColumns
// (w-64 shrink-0, set in page-column.tsx) overflow it. `flex` without
// `flex-wrap` keeps columns in a single non-wrapping row so the scroll is
// horizontal, not a wrap-to-next-line. Nothing above this in the page tree
// sets its own overflow-x, so the page body itself never scrolls
// horizontally -- only this container does.
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
