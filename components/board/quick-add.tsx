"use client";

// F248 (AS-479, AS-480, AS-482, AS-483): a single-input "quick add" control
// at the foot of each board column. Collapsed by default (a plain "+ Add
// task" trigger, AS-479); clicking/focusing it expands into a title input.
// Enter creates the task in THIS column and clears the input while keeping
// focus (AS-480), so several tasks can be added in a row without re-opening
// the control each time. Escape cancels without creating (AS-483) and
// cooperates with F244's Escape-layer stack (lib/hooks/use-shortcut.ts)
// rather than a second document-level keydown listener — this control
// registers itself as the topmost layer only while its input is open, so
// Escape closes *this* control first and never reaches (or fights with)
// any dialog/sheet open behind it. A trimmed-whitespace-only submit is
// treated as empty and does nothing, silently (AS-482, per this feature's
// Clarified implementation's resolved "Notes for clarification" answer).
//
// Reuses the existing `createTask` Server Action (lib/actions/tasks.ts)
// rather than a parallel create path -- per this feature's Clarified
// implementation ("the existing primitives... rather than new parallel
// implementations") -- so permission re-checks (canWrite, F322's
// project-visibility rule), position math (lib/board/position.ts via
// createTask's own append-to-end-of-column logic), and status/status_id
// consistency all come for free, with zero duplicated logic here.
//
// F249 (AS-481): optimistic. Before awaiting createTask, a provisional
// card (a client-generated `optimistic-<uuid>` id, this control's own
// `laneDefaults`, and a position derived from a decreasing shared
// counter so it always sorts to the bottom of the column and never
// collides with another rapid-fire optimistic add -- see
// `nextOptimisticPosition` below) is handed to the caller via
// `onOptimisticAdd` so the card appears in the board's local state
// immediately, before the network round trip. When createTask resolves,
// `onCreated(realTask, tempId)` tells the caller to reconcile: swap the
// placeholder for the real row (which carries the server-assigned id,
// task number/key, and real position) -- or, if board.tsx's Realtime
// subscription already appended that same real row first (the INSERT
// echo of this very create, see subscribe-board-realtime.ts), simply
// drop the placeholder instead of adding a duplicate. On failure,
// `onError(message, tempId)` tells the caller to roll the placeholder
// back out and show exactly one toast -- the same optimistic-update +
// rollback + single-toast convention board.tsx's own handleDragEnd
// already established for drag-and-drop (see that function's own doc
// comment), reused here rather than inventing a second shape.

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTask } from "@/lib/actions/tasks";
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";
import type { TaskCardTask } from "@/components/task/task-card";

let optimisticPositionCounter = 0;

/** Always-decreasing so every successive optimistic card sorts after the
 * previous one (bottom of the column) and two rapid quick-adds never
 * share a position, without needing to know the column's real current
 * max position (real positions live in the low thousands per
 * lib/board/position.ts -- this stays far above them until reconciled). */
function nextOptimisticPosition(): number {
  optimisticPositionCounter += 1;
  return Number.MAX_SAFE_INTEGER - optimisticPositionCounter;
}

export function QuickAdd({
  projectId,
  status,
  onCreated,
  onError,
  onOptimisticAdd,
  /** F225-consistent lane-aware creation (this feature's spec note: "a
   * quick-add inside a lane must set the lane's grouping value too"). The
   * caller (Swimlane, via BoardColumn) resolves what the CURRENT lane's
   * grouping field/value pair is; omitted for the ungrouped board and for
   * the "None" lane (nothing to set). */
  laneDefaults,
}: {
  projectId: string;
  /** The column's real name (project_statuses.name) -- the exact value
   * createTask's `status` param is re-verified against server-side, same
   * as moveTaskStatus. Never a hardcoded fixed-four-status literal. */
  status: string;
  /** F249 (AS-481): called once createTask resolves ok, with the REAL
   * server row plus the same `tempId` `onOptimisticAdd` was called with
   * moments earlier, so the caller can reconcile the two into one card. */
  onCreated: (task: TaskCardTask, tempId: string) => void;
  /** F249 (AS-481): called on failure with the same `tempId`, so the
   * caller can roll the optimistic card back out (and show one toast). */
  onError?: (message: string, tempId: string) => void;
  /** F249 (AS-481): called synchronously, before createTask is awaited,
   * with a provisional card the caller should render immediately.
   * Optional so a not-yet-updated caller (e.g. an existing test
   * rendering `<QuickAdd>` in isolation) keeps the pre-F249,
   * non-optimistic behaviour of only ever seeing the real row via
   * `onCreated`. */
  onOptimisticAdd?: (task: TaskCardTask) => void;
  laneDefaults?: {
    assigneeId?: string | null;
    priority?: TaskCardTask["priority"];
  };
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // F244 (AS-471): registers as the topmost Escape layer only while the
  // input is actually open, so Escape closes just this control (and never
  // more than one layer at a time) -- see lib/hooks/use-shortcut.ts's own
  // doc comment.
  useEscapeLayer(open, () => {
    setTitle("");
    setOpen(false);
  });

  function handleCancel() {
    setTitle("");
    setOpen(false);
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();

    // AS-482: trimmed-whitespace-only (or fully empty) submit does
    // nothing and shows no error -- the control simply stays open with
    // focus, ready for real input.
    const trimmed = title.trim();
    if (!trimmed) return;

    // F249 (AS-481): a fresh id per submit -- unique across rapid
    // successive quick-adds (crypto.randomUUID, same primitive this
    // codebase already uses for other client-generated ids -- see
    // tests/integration/subtask-actions.test.ts) and namespaced so
    // reconciliation code can recognize a still-pending placeholder at a
    // glance.
    const tempId = `optimistic-${crypto.randomUUID()}`;

    onOptimisticAdd?.({
      id: tempId,
      title: trimmed,
      // Cast follows this codebase's existing convention (see
      // board.tsx's own identical cast on a real project's column name)
      // -- `status` is any of the project's real column names at
      // runtime, not just the original 4-value literal union.
      status: status as TaskCardTask["status"],
      priority: laneDefaults?.priority ?? null,
      assigneeId: laneDefaults?.assigneeId ?? null,
      dueDate: null,
      position: nextOptimisticPosition(),
    });

    startTransition(async () => {
      const result = await createTask(
        projectId,
        trimmed,
        null,
        status,
        laneDefaults?.priority ?? null,
        laneDefaults?.assigneeId ?? null,
        null,
      );

      if (!result.ok) {
        // AS-481 Failure handling: the optimistic card reverts (caller's
        // job) and the TYPED TEXT that produced it is restored into the
        // input (this control's own actionable-on-failure contract,
        // unchanged from F248) -- but only if the user hasn't already
        // moved on and typed something new in the meantime (two rapid
        // quick-adds must not clobber each other's in-flight retry text).
        onError?.(result.error, tempId);
        setTitle((current) => (current === "" ? trimmed : current));
        return;
      }

      onCreated(
        {
          id: result.data.id,
          title: result.data.title,
          status: result.data.status as TaskCardTask["status"],
          priority: result.data.priority as TaskCardTask["priority"],
          assigneeId: result.data.assigneeId,
          dueDate: result.data.dueDate,
          position: result.data.position,
        },
        tempId,
      );
    });

    // AS-480: clear and keep focus so another task can be typed straight
    // away, without re-clicking "+ Add task" -- the optimistic card
    // (added above) already shows the just-typed title, so there's no
    // need to wait for the network round trip before the input is ready
    // for the next one.
    setTitle("");
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add task
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <Input
        ref={inputRef}
        autoFocus
        value={title}
        disabled={pending}
        placeholder="Task title"
        aria-label={`Add task to ${status}`}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          // Escape is also handled here (not only via the escape-layer
          // stack) so it works even if this input isn't currently the
          // topmost registered layer for some reason -- belt and braces,
          // matching the same defensive pattern other inline-edit
          // controls in this codebase use.
          if (event.key === "Escape") {
            event.preventDefault();
            handleCancel();
          }
          // AS-480: handled explicitly here (not just relying on the
          // surrounding <form>'s native submit-on-Enter behaviour) so
          // this works identically in every environment/test harness.
          if (event.key === "Enter") {
            event.preventDefault();
            handleSubmit();
          }
        }}
        onBlur={() => {
          // An empty input losing focus collapses back to the plain
          // trigger rather than leaving a permanently-open, empty input
          // sitting in the column.
          if (!title.trim() && !pending) setOpen(false);
        }}
      />
    </form>
  );
}
