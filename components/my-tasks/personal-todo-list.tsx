"use client";

// F416-F418: a small personal to-do list on the My Work page. Deliberately
// terse — this is not a task (no assignee/status/priority), just a
// one-line reminder that would otherwise live on a sticky note.

import { startTransition, useOptimistic, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createPersonalTodo, deleteTodo, toggleTodo } from "@/lib/actions/personal-todos";
import type { PersonalTodo } from "@/lib/queries/personal-todos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMyTasksRealtime } from "@/components/my-tasks/use-my-tasks-realtime";

export function PersonalTodoList({
  workspaceId,
  workspaceSlug,
  initialTodos,
  currentUserId,
  initialTaskIds,
}: {
  workspaceId: string;
  // Consolidation (20261116010000): optional -- only needed to link the
  // "on task: ..."/"on project: ..." chip. Absent on any render (e.g. a
  // future embed) that doesn't have a workspace slug handy; the chip is
  // simply not rendered as a link in that case.
  workspaceSlug?: string;
  initialTodos: PersonalTodo[];
  // F008 (AS-015, AS-016, AS-017): optional -- absent in any test/story
  // render that doesn't care about live task assignment updates. When
  // present, mounts the My Tasks Realtime subscription here since this is
  // the one Client Component boundary already present on the My Tasks
  // page (My Tasks itself is otherwise a Server Component, F230/F231).
  currentUserId?: string;
  // F035 (AS-016 fix): real `tasks.id` values for the tasks already
  // rendered on this page (from the server-fetched My Tasks buckets --
  // getMyTasks), NOT personal-todo ids. Personal to-dos live in a
  // different table (`personal_todos`) and their ids never match a
  // `tasks.id`, so seeding the realtime hook's tracked-id set with them
  // (the previous bug) meant a `tasks` UPDATE for an already-visible task
  // could never be recognised until an unrelated `task_assignees` INSERT
  // happened to fire first this session. Optional -- defaults to empty,
  // same safe fallback `useMyTasksRealtime` already documents for a
  // caller that doesn't have this list yet.
  initialTaskIds?: string[];
}) {
  const router = useRouter();

  // F008/F025: the real task buckets rendered above/below this component
  // are server-fetched (MyTasksPage, getMyTasks) -- this hook's own state
  // is scoped to personal to-dos only, so a live task assignment/status/
  // un-assignment/delete change is surfaced by asking the server to
  // re-render (router.refresh()) rather than by this component reaching
  // into another component's task rows. F011's reconcileMyTasksRealtimeTask
  // pure helper is the intended building block for a future, more
  // targeted client-side reconciliation of the task list itself; wiring
  // it into a stateful task-list client component is out of this
  // feature's scope (see this feature's handoff).
  useMyTasksRealtime({
    userId: currentUserId,
    // F035 (AS-016, AS-018): seed the hook's tracked-id set with the
    // server-rendered TASK ids (from getMyTasks, threaded down as
    // `initialTaskIds`) -- NOT personal-todo ids, which come from a
    // different table and never match a `tasks.id` -- so `tasks`
    // UPDATE/DELETE events for tasks already visible on this page are
    // recognised immediately, without requiring a `task_assignees` INSERT
    // to have fired first this session. See use-my-tasks-realtime.ts for
    // the tracked-id contract.
    initialTaskIds,
    onAssigned: () => router.refresh(),
    onUnassigned: () => router.refresh(),
    onUpdate: () => router.refresh(),
    onDelete: () => router.refresh(),
  });

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
  // F022: track per-row guard entries with a `committed` flag rather than
  // releasing the guard by comparing the incoming server value against the
  // confirmed value. Value-equality release freezes a row permanently if the
  // write never actually persists (server value never matches) or if another
  // actor toggles the row back to the pre-toggle value before the next sync
  // (a coincidental equality match that isn't actually "caught up"). Instead:
  // a row stays guarded (server data ignored) until the local commit
  // (`setTodos` on toggle success) sets `committed: true`, after which the
  // VERY NEXT server payload is accepted unconditionally and the guard entry
  // is removed — regardless of what value that payload carries.
  const [pendingToggles, setPendingToggles] = useState<
    ReadonlyMap<string, { isDone: boolean; committed: boolean }>
  >(() => new Map());
  if (initialTodos !== syncedInitial) {
    setSyncedInitial(initialTodos);
    if (pendingToggles.size === 0) {
      setTodos(initialTodos);
    } else {
      const stillPending = new Map(pendingToggles);
      const merged = initialTodos.map((serverTodo) => {
        const entry = pendingToggles.get(serverTodo.id);
        if (entry === undefined) return serverTodo;
        if (!entry.committed) {
          // Still in-flight (or committed locally but not yet marked as
          // such) — keep the local confirmed value, ignore this server read.
          const local = todos.find((t) => t.id === serverTodo.id);
          return local ? local : { ...serverTodo, isDone: entry.isDone };
        }
        // Committed: accept this server payload unconditionally and release
        // the guard for this row.
        stillPending.delete(serverTodo.id);
        return serverTodo;
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
    setTodos((current) => [
      ...current,
      {
        id: tempId,
        title,
        isDone: false,
        position: 0,
        taskId: null,
        taskKey: null,
        taskTitle: null,
        projectId: null,
        projectName: null,
      },
    ]);
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
    setPendingToggles((current) =>
      new Map(current).set(todo.id, { isDone: intendedIsDone, committed: false }),
    );

    function clearPending() {
      setPendingToggles((current) => {
        if (!current.has(todo.id)) return current;
        const next = new Map(current);
        next.delete(todo.id);
        return next;
      });
    }

    function markCommitted() {
      setPendingToggles((current) => {
        const entry = current.get(todo.id);
        if (!entry || entry.committed) return current;
        const next = new Map(current);
        next.set(todo.id, { ...entry, committed: true });
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
        markCommitted();
        // F020/F022: do NOT clearPending() here. The commit above and any
        // `router.refresh()` triggered elsewhere race independently; if a
        // refresh's server read happened before this write landed, it can
        // arrive with the stale pre-toggle value. Instead mark this row's
        // guard entry as `committed`; the sync effect above then accepts the
        // VERY NEXT server payload unconditionally (rather than requiring it
        // to match `intendedIsDone`, which could freeze the row forever if
        // the write never actually persisted or another actor re-toggled it).
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
    // F022: a deleted row can no longer receive a meaningful server sync —
    // clear any guard entry so it doesn't linger in the map forever.
    setPendingToggles((current) => {
      if (!current.has(todoId)) return current;
      const next = new Map(current);
      next.delete(todoId);
      return next;
    });
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
            <div className="flex flex-1 flex-col">
              <span
                className={
                  todo.isDone
                    ? "text-sm text-muted-foreground line-through"
                    : "text-sm"
                }
              >
                {todo.title}
              </span>
              {todo.taskId && workspaceSlug && (
                <Link
                  href={`/w/${workspaceSlug}/t/${todo.taskKey ?? todo.taskId}`}
                  className="text-xs text-primary hover:underline"
                >
                  on task: {todo.taskTitle ?? todo.taskKey}
                </Link>
              )}
              {!todo.taskId && todo.projectId && workspaceSlug && (
                <Link
                  href={`/w/${workspaceSlug}/projects/${todo.projectId}/list`}
                  className="text-xs text-primary hover:underline"
                >
                  on project: {todo.projectName ?? "project"}
                </Link>
              )}
            </div>
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
