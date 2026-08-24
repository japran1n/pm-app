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
// Not optimistic: this control awaits createTask and only then reports
// the created task to its caller (onCreated) -- F249 owns turning THIS
// callback into an optimistic add-then-reconcile flow; this component's
// contract (call onCreated with the server's real created task, or
// onError with a message) is the seam F249 builds on, deliberately left
// unchanged here.

"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTask } from "@/lib/actions/tasks";
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";
import type { TaskCardTask } from "@/components/task/task-card";

export function QuickAdd({
  projectId,
  status,
  onCreated,
  onError,
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
  onCreated: (task: TaskCardTask) => void;
  onError?: (message: string) => void;
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
        onError?.(result.error);
        return;
      }

      onCreated({
        id: result.data.id,
        title: result.data.title,
        status: result.data.status as TaskCardTask["status"],
        priority: result.data.priority as TaskCardTask["priority"],
        assigneeId: result.data.assigneeId,
        dueDate: result.data.dueDate,
        position: result.data.position,
      });

      // AS-480: clear and keep focus so another task can be typed
      // straight away, without re-clicking "+ Add task".
      setTitle("");
      inputRef.current?.focus();
    });
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
