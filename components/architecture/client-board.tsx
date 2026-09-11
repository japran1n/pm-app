"use client";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ClientPageColumn } from "@/components/architecture/client-page-column";

// Mission 20260910-182104, F037 (AS-091, AS-098): the portal's read-only
// counterpart to `components/architecture/board.tsx`. Same horizontal
// scroll layout (one column per page, `overflow-x-auto`, non-wrapping
// flex row) but NO DndContext/SortableContext -- there is nothing to
// drag here, this view has no editing affordances at all. Client
// Component only because `overflow-x-auto` benefits from the same
// horizontal-scroll interactivity the team board's container gets, not
// because anything here holds state; `components` is accepted for
// contract parity with the team board and future features (e.g.
// component hover highlighting) that may want it, but is unused today.
export function ClientArchitectureBoard({
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
        <ClientPageColumn key={page.id} page={page} />
      ))}
    </div>
  );
}
