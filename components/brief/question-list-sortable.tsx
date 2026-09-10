"use client";

// F052 (AS-107, AS-108): drag-and-drop reordering of the brief
// questionnaire's questions. Mirrors components/nav/project-nav-list.tsx's
// dnd-kit wiring (same PointerSensor + KeyboardSensor pairing, same
// arrayMove-then-optimistic-update-then-call-the-action flow) rather than
// inventing a second pattern for the same interaction.
//
// AS-108 ("a reordered question keeps its position after reload") is
// satisfied by persisting every question's new `position` via
// `reorderBriefQuestions` (lib/actions/brief.ts) -- the next read of this
// list (lib/queries/brief.ts's `getBrief`/`getBriefForClient`, both
// `order("position", { ascending: true })`) reflects the write.

import { useState } from "react";
import { GripVertical } from "lucide-react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { reorderBriefQuestions } from "@/lib/actions/brief";
import type { BriefQuestion } from "@/lib/queries/brief";

function SortableQuestionCard({
  question,
  index,
}: {
  question: BriefQuestion;
  index: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-2.5 rounded-md border bg-card p-3 shadow-xs",
        isDragging && "z-10",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder question: ${question.prompt}`}
        className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {index + 1}. {question.prompt}
        </p>
        {question.category && (
          <p className="mt-0.5 text-xs text-muted-foreground">{question.category}</p>
        )}
      </div>
    </div>
  );
}

export function QuestionListSortable({ questions }: { questions: BriefQuestion[] }) {
  const questionIdsKey = questions.map((q) => q.id).join(",");
  const [syncedKey, setSyncedKey] = useState(questionIdsKey);
  const [orderedIds, setOrderedIds] = useState<string[]>(() => questions.map((q) => q.id));

  if (questionIdsKey !== syncedKey) {
    setSyncedKey(questionIdsKey);
    setOrderedIds(questions.map((q) => q.id));
  }

  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const orderedQuestions = orderedIds
    .map((id) => questionsById.get(id))
    .filter((q): q is BriefQuestion => Boolean(q));

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

    const updates = nextOrderedIds.map((id, position) => ({ id, position }));

    reorderBriefQuestions(updates).then((result) => {
      if (!result.success) {
        toast.error(result.error ?? "Couldn't save the new question order.");
        setOrderedIds(previousOrderedIds);
      }
    });
  }

  if (orderedQuestions.length === 0) {
    return <p className="text-sm text-muted-foreground">No questions yet.</p>;
  }

  return (
    <DndContext
      id="brief-question-reorder"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {orderedQuestions.map((question, index) => (
            <SortableQuestionCard key={question.id} question={question} index={index} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
