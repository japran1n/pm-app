"use client";

import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { BoardComponent, BoardPage, BoardSection } from "@/lib/queries/architecture";
import { PageColumnHeader } from "@/components/architecture/page-column-header";
import { SortableSectionList } from "@/components/architecture/sortable-section-list";
import { AddSectionButton } from "@/components/architecture/add-section-button";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

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
  showDetails,
  detailsData,
  onDetailsInvalidate,
}: {
  page: BoardPage;
  orderedSectionIds: string[];
  sectionsById: Map<string, BoardSection>;
  components: BoardComponent[];
  onComponentClick?: (componentId: string) => void;
  showDetails?: boolean;
  detailsData?: ArchitectureNodeDetails | null;
  onDetailsInvalidate?: () => void;
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
      <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-t-md border-b bg-card p-3">
        <PageColumnHeader
          page={page}
          showDetails={showDetails}
          meta={showDetails && detailsData ? (detailsData.get(page.id)?.meta ?? null) : undefined}
          estimates={showDetails && detailsData ? (detailsData.get(page.id)?.estimates ?? []) : undefined}
          // F084: `detailsData` is null both before the lazy fetch resolves
          // and momentarily after invalidation -- in either case the chip
          // must not be clickable, otherwise Save on the stale/empty
          // popover erases every real estimate (setDisciplineEstimatesBulk
          // treats an empty input as "clear").
          detailsLoading={Boolean(showDetails) && !detailsData}
          onDetailsInvalidate={onDetailsInvalidate}
          grip={
            <button
              type="button"
              aria-label={`Reorder ${page.title}`}
              className="mt-0.5 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </button>
          }
        />
        <AddSectionButton pageTaskId={page.id} />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <SortableSectionList
          pageId={page.id}
          orderedSectionIds={orderedSectionIds}
          sectionsById={sectionsById}
          components={components}
          onComponentClick={onComponentClick}
          // F088 (AS-088): the copy-brief icon must render regardless of the
          // `showDetails` toggle -- that toggle only hides discipline
          // estimates. `detailsData` is threaded through unconditionally so
          // SectionCard's copy-brief affordance stays available even when
          // `showDetails` is false.
          detailsData={detailsData}
          onDetailsInvalidate={onDetailsInvalidate}
        />
      </div>
    </div>
  );
}
