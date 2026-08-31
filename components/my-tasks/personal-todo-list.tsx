"use client";

// F416-F418: a small personal to-do list on the My Work page. Deliberately
// terse — this is not a task (no assignee/status/priority), just a
// one-line reminder that would otherwise live on a sticky note.

import { startTransition, useOptimistic, useRef, useState } from "react";
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
  // F019/F020: ids with an in-flight or just-committed toggle, tracked as
  // component state (not a ref) so it can safely be read during render —
  // refs must never be read during render. Maps id -> the isDone value this
  // toggle has committed (or intends to commit) to. When fresh server data
  // arrives (initialTodos changes identity, e.g. from router.refresh())
  // while a row is in this map, we must not let a server value that
  // disagrees with the confirmed value clobber local state for that row —
  // this covers both the in-flight window AND the window between
  // `setTodos` committing and the next server sync actually reflecting that
  // write (a `router.refresh()` triggered concurrently can otherwise land
  // with pre-toggle data and silently revert the row). The entry is removed
  // only once an incoming server value for that row matches the confirmed
  // value, or the toggle fails (reverting to whatever the server currently
  // says). Rows not in this map still sync from the server as usual.
  const [pendingToggles, setPendingToggles] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  if (initialTodos !== syncedInitial) {
    setSyncedInitial(initialTodos);
    if (pendingToggles.size === 0) {
      setTodos(initialTodos);
    } else {
      const stillPending = new Map(pendingToggles);
      const merged = initialTodos.map((serverTodo) => {
        const confirmedIsDone = pendingToggles.get(serverTodo.id);
        if (confirmedIsDone === undefined) return serverTodo;
        if (serverTodo.isDone === confirmedIsDone) {
          // Server has caught up with the confirmed value — safe to stop
          // guarding this row.
          stillPending.delete(serverTodo.id);
          return serverTodo;
        }
        // Server data disagrees with the confirmed value (stale read that
        // raced the commit): keep the confirmed local value instead of
        // letting the server's stale value overwrite it.
        const local = todos.find((t) => t.id === serverTodo.id);
        return local ? local : { ...serverTodo, isDone: confirmedIsDone };
      });
      if (stillPending.size !== pendingToggles.size) {
        setPendingToggles(stillPending);
      }
      // Only replace the committed array when something actually differs
      // (by reference) from the current one. If every entry is unchanged —
      // the common case where only in-flight rows exist — skip the state
      // update entirely so we don't force an unnecessary base-state change
      // while a toggle is still pending.
      const unchanged =
        merged.length === todos.length && merged.every((t, i) => t === todos[i]);
      if (!unchanged) {
        setTodos(merged);
      }
    }
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

  // F015: tracks the most recently issued toggle request per todo id, so
  // that a stale response arriving after a newer toggle can be ignored
  // instead of clobbering the committed state with outdated intent.
  const latestToggleRef = useRef(new Map<string, number>());

  function handleToggle(todo: PersonalTodo) {
    // F015: capture the intended value as a local const at the START of
    // this handler, before any await. Rapid toggles of the same row can
    // resolve out of order; committing with this captured value (rather
    // than re-computing `!todo.isDone` after the await, against a possibly
    // stale closure) guarantees each response commits the intent that was
    // true when that click happened.
    const intendedIsDone = !todo.isDone;
    const requestId = (latestToggleRef.current.get(todo.id) ?? 0) + 1;
    latestToggleRef.current.set(todo.id, requestId);
    // F019/F020: mark this row in-flight, keyed to the value we intend to
    // commit, so a server-data sync arriving before OR shortly after this
    // settles doesn't reset it to a stale pre-toggle value.
    setPendingToggles((current) => new Map(current).set(todo.id, intendedIsDone));

    function clearPending() {
      setPendingToggles((current) => {
        if (!current.has(todo.id)) return current;
        const next = new Map(current);
        next.delete(todo.id);
        return next;
      });
    }

    startTransition(async () => {
      setOptimisticIsDone(todo.id);
      try {
        const result = await toggleTodo({ todoId: todo.id, isDone: intendedIsDone });

        // If a later toggle on this same todo has been issued since this
        // one started, this response is stale: skip the commit so the
        // final state matches the LAST user action, not whichever response
        // happens to resolve last. Leave the row marked in-flight — the
        // newer request will settle it.
        if (latestToggleRef.current.get(todo.id) !== requestId) return;

        if (!result.ok) {
          // No manual revert needed: useOptimistic reverts to the committed
          // `todos` state automatically once this transition settles, since
          // `setTodos` is never called on the failure path.
          // F006/AS-013: fixed error copy per clarified spec, independent of
          // the server-provided message.
          toast.error("Failed to update task");
          clearPending();
          return;
        }
        setTodos((current) =>
          current.map((t) => (t.id === todo.id ? { ...t, isDone: intendedIsDone } : t)),
        );
        // F020: do NOT clearPending() here. The commit above and any
        // `router.refresh()` triggered elsewhere race independently; if a
        // refresh's server read happened before this write landed, it can
        // arrive with the stale pre-toggle value. Leave this row guarded
        // (keyed to `intendedIsDone`) until the sync effect above observes
        // server data that actually matches the confirmed value.
      } catch {
        if (latestToggleRef.current.get(todo.id) !== requestId) return;
        // F013: a thrown rejection (network loss, 500, serialization
        // error) gets the same toast as an `{ ok: false }` return —
        // useOptimistic still reverts automatically once this transition
        // settles.
        toast.error("Failed to update task");
        clearPending();
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
