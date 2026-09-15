"use client";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ClientPageColumn } from "@/components/architecture/client-page-column";
import { useComponentHover } from "@/lib/architecture/use-component-hover";

// Mission 20260910-182104, F037 (AS-091, AS-098): the portal's read-only
// counterpart to `components/architecture/board.tsx`. Same horizontal
// scroll layout (one column per page, `overflow-x-auto`, non-wrapping
// flex row) but NO DndContext/SortableContext -- there is nothing to
// drag here, this view has no editing affordances at all. Client
// Component only because `overflow-x-auto` benefits from the same
// horizontal-scroll interactivity the team board's container gets, not
// because anything here holds state.
//
// 20260915-status-sitemap-audit, F2 (AS-10): `components` is no longer
// discarded -- `useComponentHover` (the same CSS-only, zero-re-render
// hook `board.tsx`/`canvas-board.tsx` use) is wired on this row so
// hovering one instance of a shared component highlights every other
// instance currently on screen. The hook itself only needs the DOM
// `data-component` attributes `ClientPageColumn` now sets; the full
// `components` list isn't read directly here, but is kept in the props
// contract (mirroring the team board) for a future Components-panel
// caller that composes this board alongside it.
export function ClientArchitectureBoard({
  pages,
  components,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
}) {
  void components;

  const hoverRef = useComponentHover<HTMLDivElement>();

  return (
    <div ref={hoverRef} className="flex min-h-0 gap-4 overflow-x-auto pb-4">
      {pages.map((page) => (
        <ClientPageColumn key={page.id} page={page} />
      ))}
    </div>
  );
}
