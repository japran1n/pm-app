"use client";

import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { BoardComponent, BoardPage, BoardSection } from "@/lib/queries/architecture";
import { PageKindSelector } from "@/components/architecture/page-kind-selector";
import { PageColumnHeader } from "@/components/architecture/page-column-header";
import { SortableSectionList } from "@/components/architecture/sortable-section-list";
import { DeletePageButton } from "@/components/architecture/delete-page-button";
import { AddSectionButton } from "@/components/architecture/add-section-button";
import { PageClientVisibilityToggle } from "@/components/architecture/page-client-visibility-toggle";

// Mission 20260910-182104, F006 (AS-019, AS-020, AS-021): a single page
// column on the Architecture board. One column per page (AS-019), showing
// the page name (AS-020) and, when set, the page description (AS-021).
//
// The static/CMS badge (F007) and "Add section" trigger (F013) are left as
// empty placeholder slots in the sticky header so those features only need
// to fill them in, not restructure this layout.
//
// F008 (AS-025): sections render via SectionCard, showing the section
// name (and its linked component's name, when set).
// F021 (AS-043): `orderedSectionIds` is the board's optimistic mirror of
// this page's section order (board.tsx), threaded down so a cross-column
// drag's target column always renders the section it just received
// without waiting on a route refresh -- see SortableSectionList's own doc
// comment for how it reconciles that id list against `page.sections`.
//
// F022 (AS-046, AS-047): the whole column is itself sortable -- a second,
// board-level SortableContext (board.tsx) treats each PageColumn as one
// draggable item, keyed on the page's task id and tagged
// `data: { type: "page" }` so board.tsx's single shared onDragEnd can
// tell a column drag apart from a section-card drag (which tags itself
// `type: "section"`, sortable-section-card.tsx) without needing two
// separate DndContexts. Mirrors sortable-section-card.tsx's own
// useSortable + CSS.Transform.toString + dedicated grip-handle pattern,
// just horizontal instead of vertical.
export function PageColumn({
  page,
  orderedSectionIds,
  sectionsById,
  components,
  onComponentClick,
}: {
  page: BoardPage;
  orderedSectionIds: string[];
  sectionsById: Map<string, BoardSection>;
  components: BoardComponent[];
  onComponentClick?: (componentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id, data: { type: "page" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-64 shrink-0 flex-col rounded-md border bg-card shadow-xs"
    >
      <div className="sticky top-0 z-10 flex flex-col gap-1 rounded-t-md border-b bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={`Reorder ${page.title}`}
            className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button>
          <PageColumnHeader page={page} />
          <PageKindSelector taskId={page.id} kind={page.pageKind} />
          <PageClientVisibilityToggle page={page} />
          <DeletePageButton page={page} />
        </div>
        {page.description ? (
          <p className="text-xs text-muted-foreground">{page.description}</p>
        ) : null}
        <AddSectionButton pageTaskId={page.id} />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <SortableSectionList
          pageId={page.id}
          orderedSectionIds={orderedSectionIds}
          sectionsById={sectionsById}
          components={components}
          onComponentClick={onComponentClick}
        />
      </div>
    </div>
  );
}
