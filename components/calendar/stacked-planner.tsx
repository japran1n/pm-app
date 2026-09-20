// F032: the stacked (2+ people) Planner layout -- one row per selected
// person, in `?people=` order (AS-063), each labelled with the member's
// name (AS-062). A selected person with no blocks in the visible week
// still gets their own row (AS-024) -- the empty row IS the signal a PM
// is looking for, per the feature's clarification notes.
//
// F033 fleshes out each row's body into the real per-person time-grid,
// clipped to the Mon-Fri 08:00-16:00 window via
// lib/calendar/stacked-window.ts.
//
// F035 (AS-064, AS-065): rows are drag-to-reorder via the same dnd-kit
// primitives the board / docs sidebar already use (see tech-decisions.md --
// one drag stack for the whole app, never the @dnd-kit/react rewrite).
// Reordering is client-only UI state; the URL's `?people=` param is the
// ONLY persistence -- there is no server write, no optimistic row state
// beyond what dnd-kit itself tracks during the drag. On drop, the new
// order is written back with router.replace (not push) so reordering
// doesn't pile up history entries the way navigating weeks/people does.

"use client";

import { useRouter } from "next/navigation";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { TimeOffEntry } from "@/lib/queries/time-off";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";
import { StackedPersonRow } from "@/components/calendar/stacked-person-row";
import { serializePeopleParam } from "@/lib/calendar/people-selection";

function SortableRow({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: userId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2"
      data-testid={`stacked-row-draggable-${userId}`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        data-testid={`stacked-row-drag-handle-${userId}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function StackedPlanner({
  selectedUserIds,
  blocksByUser,
  timeOffByUser,
  weekKey,
  members,
  workspaceSlug,
  selfId,
  weekParam,
}: {
  selectedUserIds: string[];
  blocksByUser: Map<string, CalendarBlock[]>;
  /** F034 (AS-066): each user's approved time-off entries overlapping the
   * visible week -- `?? []` at the row means a person with none simply
   * renders no strip, same "empty map entry is not an error" posture
   * blocksByUser already uses. */
  timeOffByUser?: Map<string, TimeOffEntry[]>;
  weekKey: string;
  members: SwitcherMember[];
  /** F035: needed to rebuild the `/w/<slug>/calendar` URL on reorder.
   * Optional so existing callers/tests that render this component without
   * wiring reorder persistence (e.g. F032's shell test) keep working --
   * a drag-end without it is simply not persisted. */
  workspaceSlug?: string;
  /** F035: needed by serializePeopleParam's `me` shorthand. */
  selfId?: string;
  /** F035: carried forward exactly as-is, same "never re-derive/normalize
   * it" posture PeopleSwitcherWrapper already uses. */
  weekParam?: string;
}) {
  const router = useRouter();

  // ONE lookup built once, not re-derived per row -- same "resolve once,
  // thread down" convention the rest of the calendar page follows.
  const membersById = new Map(members.map((m) => [m.userId, m]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      // No position change -- nothing to persist.
      return;
    }
    if (!workspaceSlug || !selfId) {
      // Reorder persistence wasn't wired up by the caller -- nothing to do.
      return;
    }

    const fromIndex = selectedUserIds.indexOf(String(active.id));
    const toIndex = selectedUserIds.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;

    const nextOrder = [...selectedUserIds];
    const [moved] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, moved);

    const params = new URLSearchParams();
    if (weekParam) {
      params.set("week", weekParam);
    }
    params.set("people", serializePeopleParam(nextOrder, selfId));

    router.replace(`/w/${workspaceSlug}/calendar?${params.toString()}`);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={selectedUserIds} strategy={verticalListSortingStrategy}>
        <div
          data-testid="stacked-planner"
          className="flex max-h-[calc(100vh-200px)] flex-col gap-3 overflow-y-auto"
        >
          {/* AS-063: rows render in `selectedUserIds` order -- never re-sorted
              (e.g. alphabetically) -- so the order matches `?people=`. */}
          {selectedUserIds.map((userId) => {
            const member = membersById.get(userId);
            // AS-062: labelled with the member's name -- falls back to email,
            // then the raw id, so a row is never unlabelled even if the
            // member record is somehow incomplete.
            const userLabel = member?.name ?? member?.email ?? userId;

            return (
              <SortableRow key={userId} userId={userId}>
                <StackedPersonRow
                  userId={userId}
                  userLabel={userLabel}
                  // AS-024: a person with no entry in blocksByUser still gets a
                  // row -- `?? []` never drops them.
                  blocks={blocksByUser.get(userId) ?? []}
                  timeOffEntries={timeOffByUser?.get(userId) ?? []}
                  weekKey={weekKey}
                />
              </SortableRow>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
