"use client";

// Mission 20260910-182104, F020 (AS-041, AS-042): a section can be
// reordered within its page by dragging (AS-041), and keeps its new
// position after reload (AS-042). Same PointerSensor + KeyboardSensor
// pairing, DndContext/SortableContext structure, and "optimistic local
// order, roll back on server failure" convention as
// components/nav/project-nav-list.tsx's drag-and-drop reorder.
//
// AS-042 relies entirely on `reorderSections` (lib/actions/
// architecture.ts) persisting the new `position` values server-side --
// the next page load (or router.refresh()) reads sections back out in
// that persisted order (lib/queries/architecture.ts already orders
// sections by `position`), so no separate "remember order" mechanism is
// needed here beyond the optimistic client-side mirror during the drag
// itself.
import { useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { reorderSections } from "@/lib/actions/architecture";
import { SortableSectionCard } from "@/components/architecture/sortable-section-card";
import type { BoardSection } from "@/lib/queries/architecture";

export function SortableSectionList({
  sections,
  pageId,
}: {
  sections: BoardSection[];
  pageId: string;
}) {
  const sectionIdsKey = sections.map((section) => section.id).join(",");
  const [syncedKey, setSyncedKey] = useState(sectionIdsKey);
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    sections.map((section) => section.id),
  );

  // Same "re-sync the optimistic mirror only when the underlying SET of
  // ids changes" convention as ProjectNavList -- a real navigation/
  // refetch always wins over a stale local drag.
  if (sectionIdsKey !== syncedKey) {
    setSyncedKey(sectionIdsKey);
    setOrderedIds(sections.map((section) => section.id));
  }

  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const orderedSections = orderedIds
    .map((id) => sectionsById.get(id))
    .filter((section): section is BoardSection => Boolean(section));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const previousOrderedIds = orderedIds;
    const nextOrderedIds = arrayMove(orderedIds, oldIndex, newIndex);
    setOrderedIds(nextOrderedIds);

    const updates = nextOrderedIds.map((id, index) => ({
      id,
      position: index + 1,
    }));

    reorderSections(updates).then((result) => {
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        setOrderedIds(previousOrderedIds);
      }
    });
  }

  if (orderedSections.length === 0) {
    return null;
  }

  return (
    <DndContext
      id={`section-reorder-${pageId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={orderedIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {orderedSections.map((section) => (
            <SortableSectionCard key={section.id} section={section} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
