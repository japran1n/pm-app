"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import type { BoardComponent, BoardPage, BoardSection } from "@/lib/queries/architecture";
import { PageColumn } from "@/components/architecture/page-column";
import {
  reorderSections,
  moveSectionToPage,
  reorderPages,
} from "@/lib/actions/architecture";

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
//
// F021 (AS-043, AS-044, AS-045): the per-column DndContext F020 introduced
// (sortable-section-list.tsx) only ever supported reordering *within* one
// page's section list -- dnd-kit's SortableContext has no notion of a drop
// landing in a DIFFERENT SortableContext than the one the drag started in
// unless a single DndContext owns both. So the DndContext moves up here,
// to the board (the common ancestor of every column), mirroring
// components/board/board.tsx's own "one DndContext for the whole board"
// convention for the Kanban board's cross-column drags. Each PageColumn
// still renders its own droppable section list (SortableSectionList) but
// no longer owns a DndContext of its own.
export function ArchitectureBoard({
  pages,
  components,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
}) {
  // Local, client-side-only mirror of every page's section id order, keyed
  // by page id -- optimistically updated on drop, rolled back to the
  // pre-drop snapshot if the persisting Server Action (reorderSections or
  // moveSectionToPage) reports failure. Re-synced below whenever the
  // underlying set of section ids (across ALL pages) changes, so a real
  // navigation/refetch always wins over a stale local drag, same
  // convention SortableSectionList already used pre-F021.
  const sectionsKey = pages
    .map((page) => `${page.id}:${page.sections.map((section) => section.id).join(",")}`)
    .join("|");
  const [syncedKey, setSyncedKey] = useState(sectionsKey);
  const [orderByPage, setOrderByPage] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      pages.map((page) => [page.id, page.sections.map((section) => section.id)]),
    ),
  );

  if (sectionsKey !== syncedKey) {
    setSyncedKey(sectionsKey);
    setOrderByPage(
      Object.fromEntries(
        pages.map((page) => [page.id, page.sections.map((section) => section.id)]),
      ),
    );
  }

  // F021 (AS-043, AS-044): a section optimistically moved into a
  // different page's column isn't present in THAT page's `page.sections`
  // prop until the next server refetch -- this board-wide map, built from
  // every page's sections, is what lets the destination column render the
  // full card (title, component link) immediately on drop rather than
  // waiting for a reload.
  const sectionsById = new Map<string, BoardSection>();
  for (const page of pages) {
    for (const section of page.sections) {
      sectionsById.set(section.id, section);
    }
  }

  // F022 (AS-046, AS-047): local, client-side-only mirror of the page
  // column order itself -- same optimistic-update / rollback-on-failure
  // convention as `orderByPage` above, just one level up (pages instead
  // of sections within a page). Re-synced whenever the underlying set of
  // page ids changes so a real navigation/refetch always wins over a
  // stale local drag.
  const pageIdsKey = pages.map((page) => page.id).join(",");
  const [syncedPageIdsKey, setSyncedPageIdsKey] = useState(pageIdsKey);
  const [pageOrder, setPageOrder] = useState<string[]>(() => pages.map((page) => page.id));

  if (pageIdsKey !== syncedPageIdsKey) {
    setSyncedPageIdsKey(pageIdsKey);
    setPageOrder(pages.map((page) => page.id));
  }

  const pagesById = new Map<string, BoardPage>();
  for (const page of pages) {
    pagesById.set(page.id, page);
  }
  const orderedPages = pageOrder
    .map((id) => pagesById.get(id))
    .filter((page): page is BoardPage => Boolean(page));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function findPageIdForSection(sectionId: string): string | null {
    for (const page of pages) {
      if ((orderByPage[page.id] ?? []).includes(sectionId)) {
        return page.id;
      }
    }
    return null;
  }

  // F024 (AS-050): dnd-kit fires onDragCancel (Escape key, or the active
  // draggable being unmounted mid-drag) instead of onDragEnd when a drag is
  // cancelled -- no `over` target is ever supplied in that path, so nothing
  // here ever mutated `orderByPage` for a cancelled drag in the first
  // place. This handler exists to make that guarantee explicit and
  // deliberate (rather than "just happens to work because we never called
  // setOrderByPage"): it re-snapshots the optimistic order from the props
  // passed in, discarding anything dnd-kit's internal drag state may have
  // implied, and it never calls a persisting Server Action.
  function handleDragCancel() {
    setOrderByPage(
      Object.fromEntries(
        pages.map((page) => [page.id, page.sections.map((section) => section.id)]),
      ),
    );
    setPageOrder(pages.map((page) => page.id));
  }

  // F022 (AS-046, AS-047): reorders the page columns themselves. Every
  // column's useSortable call tags itself `data: { type: "page" }`
  // (page-column.tsx) so this branch only ever fires for a column drag,
  // never a section-card drag (tagged `type: "section"`,
  // sortable-section-card.tsx) -- both share this one DndContext, same
  // rationale F021's doc comment gives for why sections needed a single
  // shared context to cross columns.
  function handleColumnDragEnd(activeId: string, overId: string) {
    const oldIndex = pageOrder.indexOf(activeId);
    const newIndex = pageOrder.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const previousPageOrder = pageOrder;
    const nextOrder = arrayMove(pageOrder, oldIndex, newIndex);
    setPageOrder(nextOrder);

    const updates = nextOrder.map((id, index) => ({ id, position: index + 1 }));
    reorderPages(updates).then((result) => {
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        setPageOrder(previousPageOrder);
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (active.data.current?.type === "page") {
      handleColumnDragEnd(activeId, overId);
      return;
    }

    const sourcePageId = findPageIdForSection(activeId);
    if (!sourcePageId) return;

    // A drop can land either on another section card (overId is a section
    // id -- resolve its page) or directly on a column's own droppable id
    // (a column with zero remaining sections, or dropped in empty space
    // below the last card) -- PageColumn's droppable id IS the page id,
    // so falling back to `overId` itself covers that case.
    const targetPageId = findPageIdForSection(overId) ?? overId;
    if (!pages.some((page) => page.id === targetPageId)) return;

    const previousOrderByPage = orderByPage;

    if (sourcePageId === targetPageId) {
      const currentOrder = orderByPage[sourcePageId] ?? [];
      const oldIndex = currentOrder.indexOf(activeId);
      const newIndex = currentOrder.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
      setOrderByPage((current) => ({ ...current, [sourcePageId]: nextOrder }));

      const updates = nextOrder.map((id, index) => ({ id, position: index + 1 }));
      reorderSections(updates).then((result) => {
        if (!result.success) {
          toast.error(result.error ?? "Something went wrong. Please try again.");
          setOrderByPage(previousOrderByPage);
        }
      });
      return;
    }

    // Cross-column: remove from the source page's order, insert into the
    // target page's order at the drop position (before `overId` when it
    // names another section, otherwise appended at the end -- the "dropped
    // on the empty column itself" case).
    const sourceOrder = (orderByPage[sourcePageId] ?? []).filter((id) => id !== activeId);
    const targetOrderBefore = orderByPage[targetPageId] ?? [];
    const overIndex = targetOrderBefore.indexOf(overId);
    const insertAt = overIndex === -1 ? targetOrderBefore.length : overIndex;
    const targetOrder = [
      ...targetOrderBefore.slice(0, insertAt),
      activeId,
      ...targetOrderBefore.slice(insertAt),
    ];

    setOrderByPage((current) => ({
      ...current,
      [sourcePageId]: sourceOrder,
      [targetPageId]: targetOrder,
    }));

    moveSectionToPage(activeId, targetPageId, insertAt + 1).then((result) => {
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        setOrderByPage(previousOrderByPage);
      }
    });
  }

  // F023 (AS-048, AS-049): keyboard-driven reordering (KeyboardSensor,
  // wired above) needs its own screen-reader feedback loop -- dnd-kit's
  // default announcements are generic ("draggable item was moved"), so
  // this overrides them with messages that name the actual dragged id,
  // matching the aria-labelled grip handles in sortable-section-card.tsx
  // and page-column.tsx.
  const accessibility = {
    announcements: {
      onDragStart({ active }: { active: { id: string | number } }) {
        return `Picked up item ${active.id}`;
      },
      onDragOver({
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) {
        return over ? `Moving over ${over.id}` : undefined;
      },
      onDragEnd({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) {
        return over ? `Dropped ${active.id} on ${over.id}` : `Dropped ${active.id}`;
      },
      onDragCancel({ active }: { active: { id: string | number } }) {
        return `Cancelled drag of ${active.id}`;
      },
    },
  };

  return (
    <DndContext
      id="architecture-section-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={accessibility}
    >
      <SortableContext items={pageOrder} strategy={horizontalListSortingStrategy}>
        <div className="flex min-h-0 gap-4 overflow-x-auto pb-4">
          {orderedPages.map((page) => (
            <PageColumn
              key={page.id}
              page={page}
              orderedSectionIds={orderByPage[page.id] ?? []}
              sectionsById={sectionsById}
              components={components}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
