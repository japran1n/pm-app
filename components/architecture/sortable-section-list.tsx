"use client";

// Mission 20260910-182104, F020 (AS-041, AS-042): a section can be
// reordered within its page by dragging (AS-041), and keeps its new
// position after reload (AS-042).
//
// F021 (AS-043, AS-044, AS-045): this component no longer owns a
// DndContext, drag state, or the reorder/move Server Action calls
// themselves -- board.tsx (the common ancestor of every page's column)
// owns all of that now, so a drag can land in a DIFFERENT column's
// SortableContext than the one it started in (dnd-kit requires a single
// shared DndContext for cross-container drags; see board.tsx's own doc
// comment). This component is now a pure renderer: it takes the board's
// already-computed `orderedSectionIds` for this page and a board-wide
// `sectionsById` map (so a section optimistically dropped in FROM another
// page -- not present in this page's original `page.sections` prop --
// still has full card data to render), and:
//   - registers itself as a dnd-kit droppable keyed on `pageId`, so a
//     column with zero sections (or a drop below the last card) is still
//     a valid cross-column drop target (SortableContext alone only
//     covers reordering *within* an existing list of items, same
//     rationale as components/board/board-column.tsx's own useDroppable).
//   - renders a SortableContext over `orderedSectionIds` so each card is
//     still individually draggable/keyboard-reorderable.
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { SortableSectionCard } from "@/components/architecture/sortable-section-card";
import type { BoardComponent, BoardSection } from "@/lib/queries/architecture";

export function SortableSectionList({
  pageId,
  orderedSectionIds,
  sectionsById,
  components = [],
}: {
  pageId: string;
  orderedSectionIds: string[];
  sectionsById: Map<string, BoardSection>;
  components?: BoardComponent[];
}) {
  const { setNodeRef } = useDroppable({ id: pageId });

  const orderedSections = orderedSectionIds
    .map((id) => sectionsById.get(id))
    .filter((section): section is BoardSection => Boolean(section));

  return (
    <SortableContext
      items={orderedSectionIds}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className="flex min-h-8 flex-col gap-2"
        data-page-id={pageId}
      >
        {orderedSections.map((section) => (
          <SortableSectionCard
            key={section.id}
            section={section}
            components={components}
          />
        ))}
      </div>
    </SortableContext>
  );
}
