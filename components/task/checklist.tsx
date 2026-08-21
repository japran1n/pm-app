"use client";

// F153: task detail's Checklist section (AS-269's UI half — rendering
// text + checked state — and AS-271's UI half — rename, reorder, delete
// from the UI). The write-path Server Actions themselves (add/toggle/
// rename/reorder/delete) already exist from F152
// (lib/actions/checklist.ts) and are called directly from here, same
// "Server Actions are safe to import and call from a Client Component"
// convention every other section of task-detail-sheet.tsx already uses
// (SubtaskList/CommentList/AttachmentList/TimeTracking).
//
// Pattern: same deviation from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") that SubtaskList/CommentList/AttachmentList already
// document — this component is composed *inside* task-detail-sheet.tsx,
// itself already a Client Component. The caller (getTaskDetail, via
// TaskDetailSheet) fetches this task's checklist items in the SAME query
// that fetches the task itself (lib/actions/tasks.ts's getTaskDetail —
// mirrors how it already fetches `children` for SubtaskList) and passes
// them down as `items`; this component owns rendering plus every
// interactive behaviour.
//
// Keyboard-first design (per this feature's critical context — this is
// the point of the feature, not an afterthought):
//
//   - Every checklist item is rendered as a real <input>, not read-only
//     text with a separate "edit" mode — there is nothing to click into
//     before you can type.
//   - A single trailing, not-yet-persisted "add an item" input always
//     sits after the real items (same "quick add" shape as SubtaskList's
//     own add-subtask form, just inline instead of a separate form
//     element). Enter there calls addChecklistItem (lib/actions/
//     checklist.ts F152) and keeps focus in the box, cleared, ready for
//     the next one — so typing "milk" Enter "eggs" Enter "bread" Enter
//     adds three items in a row without ever leaving the keyboard. This
//     is the literal "Enter adds the next item" behaviour.
//   - Enter on an EXISTING (already-persisted) item commits any pending
//     rename first, then moves focus forward — to the next existing
//     item, or to the trailing add box if this is the last one — so
//     walking down the list with Enter eventually lands you back at "add
//     the next item" rather than requiring a click to get there.
//     Deliberately does NOT try to insert a brand-new item in the middle
//     of the list: addChecklistItem's only contract (F152) is "append to
//     the end" (no arbitrary insert-position support), and inventing a
//     second add+reorder round trip just to simulate a mid-list insert
//     would be the more-powerful option the ambiguity-resolution rule
//     says to avoid, not the simpler one — the trailing add box already
//     gives "keep adding items" a single, always-available keyboard path.
//   - Backspace on an EMPTY existing item deletes it (deleteChecklistItem)
//     and moves focus to the previous item (or does nothing if it was
//     already the first item — nothing sensible to focus). Backspace on
//     the empty trailing add box (nothing typed yet) isn't a delete (it
//     isn't a real item yet) — it just moves focus up to the last real
//     item, so Backspace as a "walk back up the list" gesture stays
//     consistent whether you're on a real item or the add box.
//   - Reordering is available via the SAME drag handle both by pointer
//     drag AND by keyboard (Tab to the handle, Space/Enter to pick up,
//     Arrow keys to move, Space/Enter to drop, Escape to cancel) —
//     @dnd-kit's KeyboardSensor + sortableKeyboardCoordinates, configured
//     exactly like components/board/board.tsx's own DndContext (that
//     file's own comment explains why both sensors are required, not
//     optional, for this same reason: AS-523 re-checks keyboard
//     operability late in the mission, so this can never regress to
//     drag-only). The drag listeners are attached ONLY to the small grip
//     handle (via useSortable's `setActivatorNodeRef`), not the whole
//     row, so the row's own text input stays independently focusable and
//     editable without fighting the drag gesture — same reasoning as any
//     "drag handle" dnd-kit pattern, just not yet needed by
//     SortableTaskCard (whose whole card is the drag target, since a
//     card has no inline-editable text field competing for the same
//     pointer/keyboard events).
//
// Toggle (checking/unchecking) is optimistic with rollback on failure —
// per the critical context, this is the single highest-frequency
// interaction in this feature. The local list is updated the instant the
// checkbox is clicked, before toggleChecklistItem's promise resolves; a
// non-ok result (or a thrown rejection) reverts the local item back to
// its pre-click checked state and shows a sonner toast naming what
// failed, then leaves the checkbox in its (reverted) actionable state —
// same "revert + toast + stays actionable" contract as board.tsx's own
// onDragEnd rollback for drag-and-drop.
//
// Rename and delete are NOT optimistic in the same "fire, then maybe
// undo" sense reorder/toggle are — rename commits on blur/Enter only
// after the value has already changed locally (the input's own value IS
// the local state, so there's nothing further to optimistically apply),
// and a failed rename reverts the input back to the last known-good
// server value plus a toast, matching TaskDetailSheet's own
// handleTitleBlur convention exactly. Delete removes the row from local
// state immediately (optimistic) and re-inserts it (with a toast) if the
// server call fails, so an accidental Backspace-delete under a flaky
// connection doesn't silently strand the item as "gone from view, still
// in the database".
//
// A checklist item's max length (500) matches addChecklistItemSchema/
// renameChecklistItemSchema (lib/validation/checklist.ts) — the client
// enforces the same bound for immediate feedback, per the Clarified
// implementation's Validation rules answer ("the client check never
// stands alone"); the server re-validates regardless.
//
// Progress bar: this feature's own "checked / total for THIS task's
// checklist" summary (lib/tasks/checklist-progress.ts), rendered via the
// shared components/ui/progress.tsx primitive plus a numeric label
// (colour is never the only signal, matching this codebase's existing
// AS-153 convention elsewhere). This is explicitly NOT the task-level
// completion percentage across checklist AND subtasks together — that's
// AS-272/AS-273, F154's job, not built here. Hidden entirely when there
// are zero items, mirroring SubtaskList's identical "only show the count
// once there's something to count" convention.
//
// Access control note (same as SubtaskList's/F150's own documented
// decision): lib/auth/permissions.ts does not exist yet in this codebase
// (AS-230's own not-yet-built feature, M11 lands after M13 in this
// mission's plan). Rather than invent an early, throwaway version of that
// predicate here, every control in this component is available to any
// active workspace member and re-verified server-side by each Server
// Action itself (requireActiveMembership, lib/actions/checklist.ts) —
// same convention every sibling section of this Sheet already follows.

import { useEffect, useRef, useState, useTransition } from "react";
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
import { GripVertical, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addChecklistItem,
  deleteChecklistItem,
  renameChecklistItem,
  reorderChecklistItem,
  toggleChecklistItem,
} from "@/lib/actions/checklist";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { calculatePosition } from "@/lib/board/position";
import { countChecklistProgress } from "@/lib/tasks/checklist-progress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const CONTENT_MAX_LENGTH = 500;

// Sentinel value for the "focus the draft add-box next" case in
// focusTargetOnNextRender — distinct from any real item id (a uuid).
const DRAFT_FOCUS_TARGET = "__checklist_draft__";

export type ChecklistListItem = {
  id: string;
  content: string;
  isChecked: boolean;
  position: number;
};

function ChecklistItemRow({
  item,
  registerInputRef,
  onToggle,
  onContentChange,
  onCommitRename,
  onDelete,
  onKeyDown,
  disabled,
  disabledTitle,
  canDrag,
}: {
  item: ChecklistListItem;
  registerInputRef: (id: string, element: HTMLInputElement | null) => void;
  onToggle: (item: ChecklistListItem) => void;
  onContentChange: (id: string, value: string) => void;
  onCommitRename: (item: ChecklistListItem) => void;
  onDelete: (item: ChecklistListItem) => void;
  onKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    item: ChecklistListItem,
  ) => void;
  /** Disabled while this item's toggle/rename/delete is in flight, so a
   * second interaction can't race the first. Does not disable the drag
   * handle — reordering a not-yet-confirmed item is harmless (the
   * eventual reorder call just persists whatever position it lands on). */
  disabled: boolean;
  /** F135 (AS-231): explains a disabled row when it's the permission gate
   * (not just an in-flight mutation) causing it — undefined otherwise. */
  disabledTitle?: string;
  /** F135 (AS-231): viewers/guests can't reorder checklist items either. */
  canDrag: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 rounded-md px-1 py-0.5"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        aria-label={`Reorder ${item.content || "checklist item"}`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <Checkbox
        checked={item.isChecked}
        disabled={disabled}
        title={disabledTitle}
        onCheckedChange={() => onToggle(item)}
        aria-label={
          item.isChecked
            ? `Mark "${item.content}" as not done`
            : `Mark "${item.content}" as done`
        }
      />

      <Input
        ref={(element) => registerInputRef(item.id, element)}
        value={item.content}
        disabled={disabled}
        title={disabledTitle}
        maxLength={CONTENT_MAX_LENGTH}
        aria-label="Checklist item text"
        className={cn(
          "h-7 flex-1 border-transparent bg-transparent px-1.5 shadow-none focus-visible:border-ring focus-visible:bg-background",
          item.isChecked && "text-muted-foreground line-through",
        )}
        onChange={(event) => onContentChange(item.id, event.target.value)}
        onBlur={() => onCommitRename(item)}
        onKeyDown={(event) => onKeyDown(event, item)}
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        disabled={disabled}
        title={disabledTitle}
        aria-label={`Delete "${item.content || "checklist item"}"`}
        onClick={() => onDelete(item)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function Checklist({
  taskId,
  items,
  currentUserRole,
}: {
  /** The task this checklist belongs to. */
  taskId: string;
  /** This task's current checklist items, from getTaskDetail's own query
   * (lib/actions/tasks.ts), ideally already position-ascending. */
  items: ChecklistListItem[];
  /** F135 (AS-231): threaded straight through from TaskDetailSheet's own
   * `currentUserRole` prop, same convention CommentList/TimeTracking/
   * TagsEditor already use — viewers/guests never see a usable
   * add/toggle/rename/delete/reorder control. Undefined (an existing
   * caller/test that hasn't been updated) is treated as permissive. */
  currentUserRole?: WorkspaceRole;
}) {
  const canEditChecklist = currentUserRole
    ? canWrite({ role: currentUserRole })
    : true;
  const checklistDisabledTitle = canEditChecklist
    ? undefined
    : "You don't have permission to edit the checklist.";
  const [localItems, setLocalItems] = useState(items);
  const [draft, setDraft] = useState("");
  // Tracks which task's items are currently loaded into local state, so
  // it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as SubtaskList's/
  // CommentList's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isAdding, startAddTransition] = useTransition();
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  // Pending focus move, consumed (and cleared) by the effect below. State,
  // not a ref: this codebase's react-hooks/refs lint rule forbids reading
  // or writing a ref's `.current` directly in the render body (only in
  // event handlers or effects) — an actual DOM focus() call is exactly
  // the kind of "synchronize with an external system" work useEffect
  // exists for, so this (unlike syncedTaskId's own plain-state resync
  // just below, which only ever calls setState, never touches a ref) is
  // the one piece of this component's "sync on change" logic that
  // genuinely needs an Effect rather than the render-time-state-adjust
  // pattern the rest of this file follows.
  // Tagged with a monotonically increasing `token` (not just the bare
  // target id/DRAFT_FOCUS_TARGET string) so that requesting focus on the
  // SAME target twice in a row (e.g. two consecutive Backspace-deletes
  // that both resolve to "focus the new first item") still produces a
  // distinct state value each time — otherwise React's bail-out-on-
  // identical-state-value behaviour would silently skip the second
  // focus() call, since the effect below only re-runs when this value
  // actually changes.
  const [pendingFocus, setPendingFocus] = useState<{
    target: string;
    token: number;
  } | null>(null);
  const focusTokenRef = useRef(0);

  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const draftRef = useRef<HTMLInputElement | null>(null);
  // "Last known good" content per item id — what a failed rename reverts
  // to. Deliberately NOT re-derived from the `items` prop at revert time:
  // that prop is this Sheet's one-time initial fetch and never changes
  // for the life of the open Sheet, so after a FIRST successful rename a
  // second rename's failure would otherwise revert all the way back to
  // the original pre-Sheet-open text, not to the (already-persisted)
  // in-between value. Seeded from `items` and updated on every successful
  // rename/add below (in event-handler `.then()` continuations — never
  // during render, same rule as pendingFocus above); reset by the
  // effect further down whenever `items` itself changes (a new task's
  // detail was fetched).
  const knownGoodContentRef = useRef(
    new Map(items.map((item) => [item.id, item.content])),
  );

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalItems(items);
    setDraft("");
  }

  // items is intentionally omitted from the dependency array below: it's
  // a new array reference on every fetch, but `taskId` is the correct
  // "did the underlying task actually change" signal, matching
  // syncedTaskId's own resync condition above — re-running this on every
  // `items` identity change would also fire on a plain re-render where
  // the caller happens to pass a fresh (but equivalent) array.
  useEffect(() => {
    knownGoodContentRef.current = new Map(
      items.map((item) => [item.id, item.content]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.target === DRAFT_FOCUS_TARGET) {
      draftRef.current?.focus();
    } else {
      inputRefs.current.get(pendingFocus.target)?.focus();
    }
  }, [pendingFocus]);

  function requestFocus(target: string) {
    focusTokenRef.current += 1;
    setPendingFocus({ target, token: focusTokenRef.current });
  }

  function registerInputRef(id: string, element: HTMLInputElement | null) {
    if (element) {
      inputRefs.current.set(id, element);
    } else {
      inputRefs.current.delete(id);
    }
  }

  const progress = countChecklistProgress(localItems);

  function handleContentChange(id: string, value: string) {
    setLocalItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, content: value } : item)),
    );
  }

  function handleToggle(item: ChecklistListItem) {
    const nextChecked = !item.isChecked;
    // Optimistic: flip the local state immediately (highest-frequency
    // interaction in this feature, per the critical context), before the
    // Server Action's promise settles.
    setLocalItems((previous) =>
      previous.map((current) =>
        current.id === item.id ? { ...current, isChecked: nextChecked } : current,
      ),
    );

    void toggleChecklistItem(item.id, nextChecked)
      .then((result) => {
        if (!result.ok) {
          setLocalItems((previous) =>
            previous.map((current) =>
              current.id === item.id
                ? { ...current, isChecked: item.isChecked }
                : current,
            ),
          );
          toast.error(result.error);
        }
      })
      .catch(() => {
        setLocalItems((previous) =>
          previous.map((current) =>
            current.id === item.id
              ? { ...current, isChecked: item.isChecked }
              : current,
          ),
        );
        toast.error(
          "Something went wrong updating that item. Please try again.",
        );
      });
  }

  function handleCommitRename(item: ChecklistListItem) {
    const serverContent = knownGoodContentRef.current.get(item.id) ?? item.content;
    const trimmed = item.content.trim();

    if (!trimmed) {
      // Same "revert rather than allow an empty value" convention as
      // TaskDetailSheet's handleTitleBlur — deleting is Backspace's job
      // (see handleItemKeyDown below), not an accidental empty blur.
      setLocalItems((previous) =>
        previous.map((current) =>
          current.id === item.id ? { ...current, content: serverContent } : current,
        ),
      );
      return;
    }

    if (trimmed === serverContent) {
      // No-op: either nothing changed, or the change was already
      // reverted to the last known-good server value above.
      if (trimmed !== item.content) {
        setLocalItems((previous) =>
          previous.map((current) =>
            current.id === item.id ? { ...current, content: trimmed } : current,
          ),
        );
      }
      return;
    }

    setBusyItemId(item.id);
    void renameChecklistItem(item.id, trimmed)
      .then((result) => {
        if (result.ok) {
          knownGoodContentRef.current.set(item.id, result.data.content);
          setLocalItems((previous) =>
            previous.map((current) =>
              current.id === item.id
                ? { ...current, content: result.data.content }
                : current,
            ),
          );
        } else {
          setLocalItems((previous) =>
            previous.map((current) =>
              current.id === item.id
                ? { ...current, content: serverContent }
                : current,
            ),
          );
          toast.error(result.error);
        }
      })
      .catch(() => {
        setLocalItems((previous) =>
          previous.map((current) =>
            current.id === item.id ? { ...current, content: serverContent } : current,
          ),
        );
        toast.error(
          "Something went wrong renaming that item. Please try again.",
        );
      })
      .finally(() => {
        setBusyItemId((current) => (current === item.id ? null : current));
      });
  }

  function handleDelete(
    item: ChecklistListItem,
    options?: { focusPreviousItem?: boolean },
  ) {
    const snapshot = localItems;
    const index = snapshot.findIndex((current) => current.id === item.id);

    // Optimistic removal — see this file's header comment for why delete
    // (unlike toggle) removes immediately and re-inserts on failure,
    // rather than waiting for the server first.
    setLocalItems((previous) => previous.filter((current) => current.id !== item.id));

    if (options?.focusPreviousItem) {
      // Backspace-triggered delete: move focus to the previous item, so
      // repeated Backspace walks up the list — the previous item's `id`
      // is still a valid inputRefs key after this render (only the
      // deleted row is removed). If there's no previous item (this was
      // the first row), leave focus alone rather than guessing a target.
      const previousItem = index > 0 ? snapshot[index - 1] : null;
      if (previousItem) {
        requestFocus(previousItem.id);
      }
    } else {
      // Trash-button-triggered delete: return focus to the draft "add an
      // item" box, a sensible default landing spot for a pointer user.
      requestFocus(DRAFT_FOCUS_TARGET);
    }

    void deleteChecklistItem(item.id)
      .then((result) => {
        if (!result.ok) {
          setLocalItems((previous) => {
            if (previous.some((current) => current.id === item.id)) return previous;
            const restored = [...previous];
            restored.splice(Math.min(index, restored.length), 0, item);
            return restored;
          });
          toast.error(result.error);
        }
      })
      .catch(() => {
        setLocalItems((previous) => {
          if (previous.some((current) => current.id === item.id)) return previous;
          const restored = [...previous];
          restored.splice(Math.min(index, restored.length), 0, item);
          return restored;
        });
        toast.error(
          "Something went wrong deleting that item. Please try again.",
        );
      });
  }

  function handleAddFromDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;

    startAddTransition(async () => {
      const result = await addChecklistItem(taskId, trimmed);
      if (result.ok) {
        knownGoodContentRef.current.set(result.data.id, result.data.content);
        setLocalItems((previous) => [
          ...previous,
          {
            id: result.data.id,
            content: result.data.content,
            isChecked: result.data.isChecked,
            position: result.data.position,
          },
        ]);
        setDraft("");
        // Keeps focus in the draft box (it's still mounted, only its
        // value is cleared) so repeated Enter presses keep adding items
        // without a re-focus — the literal "Enter adds the next item"
        // flow this feature exists for. Goes through requestFocus (state
        // + effect), NOT a direct draftRef.current.focus() call here:
        // this line still runs while `isAdding` is true (the transition
        // callback hasn't returned yet), so the draft <input>'s own
        // `disabled={isAdding}` is still in effect in the DOM at this
        // exact moment — calling .focus() on a currently-disabled form
        // control is a browser no-op. requestFocus defers the actual
        // focus() call to the effect below, which runs after the render
        // that flips `disabled` back off.
        requestFocus(DRAFT_FOCUS_TARGET);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddFromDraft();
      return;
    }
    if (event.key === "Backspace" && draft === "" && localItems.length > 0) {
      // The draft box isn't a real item yet — Backspace here just walks
      // focus back up to the last real item, mirroring Backspace's
      // behaviour on an empty existing item below.
      event.preventDefault();
      const lastItem = localItems[localItems.length - 1];
      inputRefs.current.get(lastItem.id)?.focus();
    }
  }

  function handleItemKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    item: ChecklistListItem,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCommitRename(item);
      const index = localItems.findIndex((current) => current.id === item.id);
      const nextItem = localItems[index + 1];
      if (nextItem) {
        inputRefs.current.get(nextItem.id)?.focus();
      } else {
        draftRef.current?.focus();
      }
      return;
    }

    if (event.key === "Backspace" && item.content === "") {
      event.preventDefault();
      handleDelete(item, { focusPreviousItem: true });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const snapshot = localItems;
    const oldIndex = snapshot.findIndex((item) => item.id === active.id);
    const newIndex = snapshot.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(snapshot, oldIndex, newIndex);
    const prevNeighbor = reordered[newIndex - 1] ?? null;
    const nextNeighbor = reordered[newIndex + 1] ?? null;
    const newPosition = calculatePosition(
      prevNeighbor?.position ?? null,
      nextNeighbor?.position ?? null,
    );

    const movedItem = { ...reordered[newIndex], position: newPosition };
    const next = [
      ...reordered.slice(0, newIndex),
      movedItem,
      ...reordered.slice(newIndex + 1),
    ];

    // Optimistic reorder — the row visually settles into its new spot
    // before reorderChecklistItem's promise resolves; rolled back to the
    // pre-drag snapshot with an error toast on failure, same contract as
    // components/board/board.tsx's own onDragEnd.
    setLocalItems(next);

    void reorderChecklistItem(movedItem.id, newPosition)
      .then((result) => {
        if (!result.ok) {
          setLocalItems(snapshot);
          toast.error(result.error);
        }
      })
      .catch(() => {
        setLocalItems(snapshot);
        toast.error(
          "Something went wrong reordering that item. Please try again.",
        );
      });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Checklist</Label>
        {progress.total > 0 && (
          <span className="text-xs text-muted-foreground">
            {progress.checked} of {progress.total} checked
          </span>
        )}
      </div>

      {progress.total > 0 && (
        <Progress
          value={(progress.checked / progress.total) * 100}
          aria-label="Checklist progress"
        />
      )}

      {localItems.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListChecks className="size-4" aria-hidden="true" />
          No checklist items yet. Add one below.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localItems.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5">
              {localItems.map((item) => (
                <ChecklistItemRow
                  key={item.id}
                  item={item}
                  registerInputRef={registerInputRef}
                  onToggle={handleToggle}
                  onContentChange={handleContentChange}
                  onCommitRename={handleCommitRename}
                  onDelete={(current) => handleDelete(current)}
                  onKeyDown={handleItemKeyDown}
                  disabled={busyItemId === item.id || !canEditChecklist}
                  disabledTitle={canEditChecklist ? undefined : checklistDisabledTitle}
                  canDrag={canEditChecklist}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex items-center gap-1.5 px-1">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor={`checklist-draft-${taskId}`} className="sr-only">
          Add a checklist item
        </Label>
        <Input
          id={`checklist-draft-${taskId}`}
          ref={draftRef}
          value={draft}
          disabled={isAdding || !canEditChecklist}
          title={checklistDisabledTitle}
          placeholder="Add an item…"
          className="h-7 flex-1 border-transparent bg-transparent px-1.5 shadow-none focus-visible:border-ring focus-visible:bg-background"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          maxLength={CONTENT_MAX_LENGTH}
        />
        {isAdding && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
