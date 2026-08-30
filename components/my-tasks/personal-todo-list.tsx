"use client";

// F416-F418: a small personal to-do list on the My Work page. Deliberately
// terse — this is not a task (no assignee/status/priority), just a
// one-line reminder that would otherwise live on a sticky note.

import { startTransition, useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createPersonalTodo, deleteTodo, toggleTodo } from "@/lib/actions/personal-todos";
import type { PersonalTodo } from "@/lib/queries/personal-todos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function PersonalTodoList({
  workspaceId,
  initialTodos,
}: {
  workspaceId: string;
  initialTodos: PersonalTodo[];
}) {
  const router = useRouter();
  const [todos, setTodos] = useState(initialTodos);
  const [syncedInitial, setSyncedInitial] = useState(initialTodos);
  if (initialTodos !== syncedInitial) {
    setSyncedInitial(initialTodos);
    setTodos(initialTodos);
  }
  const [newTitle, setNewTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // F006: optimistic checkbox toggle. `optimisticTodos` is derived from the
  // committed `todos` state; toggling flips isDone immediately for instant
  // strikethrough feedback, then automatically reverts to the committed
  // state if the transition completes without `setTodos` being called
  // (i.e. on server failure).
  const [optimisticTodos, setOptimisticIsDone] = useOptimistic(
    todos,
    (state, toggledId: string) =>
      state.map((t) => (t.id === toggledId ? { ...t, isDone: !t.isDone } : t)),
  );

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title || isSubmitting) return;
    setIsSubmitting(true);

    // Optimistic append: this list is small and personal, so the round
    // trip cost of waiting for revalidation before showing what was just
    // typed would be the most noticeable lag on the whole page.
    const tempId = `temp-${Date.now()}`;
    setTodos((current) => [...current, { id: tempId, title, isDone: false, position: 0 }]);
    setNewTitle("");

    const result = await createPersonalTodo({ workspaceId, title });
    setIsSubmitting(false);

    if (!result.ok) {
      setTodos((current) => current.filter((t) => t.id !== tempId));
      toast.error(result.error);
      return;
    }

    router.refresh();
  }

  function handleToggle(todo: PersonalTodo) {
    startTransition(async () => {
      setOptimisticIsDone(todo.id);
      try {
        const result = await toggleTodo({ todoId: todo.id, isDone: !todo.isDone });
        if (!result.ok) {
          // No manual revert needed: useOptimistic reverts to the committed
          // `todos` state automatically once this transition settles, since
          // `setTodos` is never called on the failure path.
          // F006/AS-013: fixed error copy per clarified spec, independent of
          // the server-provided message.
          toast.error("Failed to update task");
          return;
        }
        setTodos((current) =>
          current.map((t) => (t.id === todo.id ? { ...t, isDone: !todo.isDone } : t)),
        );
      } catch {
        // F013: a thrown rejection (network loss, 500, serialization
        // error) gets the same toast as an `{ ok: false }` return —
        // useOptimistic still reverts automatically once this transition
        // settles.
        toast.error("Failed to update task");
      }
    });
  }

  async function handleDelete(todoId: string) {
    const previous = todos;
    setTodos((current) => current.filter((t) => t.id !== todoId));
    const result = await deleteTodo({ todoId });
    if (!result.ok) {
      setTodos(previous);
      toast.error(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">Personal to-dos</h2>
      <p className="text-xs text-muted-foreground">
        Visible only to you — not a task, not assigned, not shared.
      </p>

      <ul className="flex flex-col gap-1">
        {optimisticTodos.map((todo) => (
          <li key={todo.id} className="group flex items-center gap-2">
            <Checkbox
              checked={todo.isDone}
              onCheckedChange={() => handleToggle(todo)}
              aria-label={`Mark "${todo.title}" ${todo.isDone ? "not done" : "done"}`}
            />
            <span
              className={
                todo.isDone
                  ? "flex-1 text-sm text-muted-foreground line-through"
                  : "flex-1 text-sm"
              }
            >
              {todo.title}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(todo.id)}
              aria-label={`Delete "${todo.title}"`}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {optimisticTodos.length === 0 && (
          <li className="text-sm text-muted-foreground">Nothing here yet.</li>
        )}
      </ul>

      <div className="flex items-center gap-2 pt-1">
        <Input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Add a reminder..."
          disabled={isSubmitting}
          className="h-8"
          aria-label="New personal to-do"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleCreate}
          disabled={isSubmitting || !newTitle.trim()}
          aria-label="Add to-do"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
