"use client";

// Mission 20260910-182104, F020 (AS-041, AS-042): dnd-kit sortable wrapper
// around SectionCard, mirroring components/nav/project-nav-list.tsx's
// `SortableProjectRow` pattern (useSortable + CSS.Transform.toString for
// the drag transform, a dedicated grip handle rather than making the
// whole card draggable -- the card's title is its own click target for
// inline rename, F015, and dnd-kit's listeners on the full card would
// otherwise compete with that click).
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { SectionCard } from "@/components/architecture/section-card";
import type { BoardComponent, BoardSection } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

export function SortableSectionCard({
  section,
  components = [],
  onComponentClick,
  detailsData,
  onDetailsInvalidate,
}: {
  section: BoardSection;
  components?: BoardComponent[];
  onComponentClick?: (componentId: string) => void;
  detailsData?: ArchitectureNodeDetails | null;
  onDetailsInvalidate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id, data: { type: "section" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/section relative">
      <button
        type="button"
        aria-label={`Reorder ${section.title}`}
        className="absolute -left-1 top-1/2 z-10 -translate-x-full -translate-y-1/2 cursor-grab touch-none rounded-sm p-1 text-muted-foreground/40 opacity-0 hover:text-muted-foreground group-hover/section:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
      <SectionCard
        section={section}
        components={components}
        onComponentClick={onComponentClick}
        detailsData={detailsData}
        onDetailsInvalidate={onDetailsInvalidate}
      />
    </div>
  );
}
