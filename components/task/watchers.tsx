"use client";

// F165 (AS-297): watch/unwatch toggle + watcher avatar group for the task
// detail header. Composition, not reinvention (same convention
// user-avatar-group.tsx's own doc comment already established for F161):
// every avatar is rendered via the existing `UserAvatarGroup` (F161), this
// file only owns the toggle button and the optimistic local state around
// it. No second stacked-avatar component.
//
// Optimistic toggle with rollback (clarified spec): mirrors
// TaskDetailSheet's own `handleAssigneesToggle` / CommentList's
// optimistic-local-state convention — flip local state immediately, call
// the Server Action, roll back and toast.error on failure, toast.success
// on success (same "both directions surface a toast" convention
// `handleAssigneesToggle` already uses for the sibling assignee picker).
//
// Visually subordinate to assignees (clarified spec's own ambiguity-
// resolution note): rendered as a single small ghost button plus a
// compact `size="sm"` avatar group in the Sheet header, not inside the
// larger status/priority/assignee/due-date metadata grid below it.

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { watchTask, unwatchTask } from "@/lib/actions/watchers";
import { Button } from "@/components/ui/button";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import type { UserAvatarPerson } from "@/components/user-avatar";

export type WatchersMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl?: string | null;
};

export function Watchers({
  taskId,
  watcherIds,
  isWatching,
  members,
  currentUserId,
}: {
  taskId: string;
  /** F165 (AS-297): this task's current watcher set (`is_watching: true`
   * only), from getTaskDetail's own `task_watchers` fetch — no second
   * round trip. */
  watcherIds: string[];
  /** Whether the SIGNED-IN caller specifically is currently watching —
   * drives the toggle button's own label/icon, never a generic count
   * (clarified spec). */
  isWatching: boolean;
  /** Workspace members, used to resolve a watcher id to a name/avatar for
   * the avatar group — same source TaskDetailSheet's assignee picker
   * already resolves `assigneeIds` against. */
  members: WatchersMember[];
  /** The signed-in caller's own id. Undefined (caller hasn't wired it
   * through yet) disables the toggle entirely rather than guessing who
   * "the caller" is — a safe default matching this codebase's other
   * currentUserId-gated affordances (e.g. CommentList's delete button). */
  currentUserId?: string;
}) {
  // Local, optimistic mirror of the server-derived props — re-synced
  // below whenever the task changes (same "adjust state during render on
  // prop change" convention as CommentList's syncedTaskId / TagsEditor's
  // syncedTaskId), so navigating to a different task never shows the
  // previous task's stale watcher state for a render.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [localWatcherIds, setLocalWatcherIds] = useState(watcherIds);
  const [localIsWatching, setLocalIsWatching] = useState(isWatching);
  const [isToggling, startToggleTransition] = useTransition();

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalWatcherIds(watcherIds);
    setLocalIsWatching(isWatching);
  }

  const people: UserAvatarPerson[] = localWatcherIds.map((id) => {
    const member = members.find((m) => m.userId === id);
    return {
      id,
      name: member?.name ?? null,
      email: member?.email ?? null,
      avatarUrl: member?.avatarUrl ?? null,
    };
  });

  function handleToggle() {
    if (!currentUserId) return;

    const previousWatcherIds = localWatcherIds;
    const previousIsWatching = localIsWatching;
    const nextIsWatching = !previousIsWatching;

    // Optimistic update: flip immediately, before the network round trip.
    setLocalIsWatching(nextIsWatching);
    setLocalWatcherIds(
      nextIsWatching
        ? previousWatcherIds.includes(currentUserId)
          ? previousWatcherIds
          : [...previousWatcherIds, currentUserId]
        : previousWatcherIds.filter((id) => id !== currentUserId),
    );

    startToggleTransition(async () => {
      const result = nextIsWatching
        ? await watchTask(taskId)
        : await unwatchTask(taskId);

      if (result.ok) {
        toast.success(
          nextIsWatching ? "Watching this task." : "Stopped watching this task.",
        );
      } else {
        // Rollback on failure — restore exactly what was there before the
        // optimistic flip, matching this codebase's established
        // optimistic-update-with-toast-rollback pattern.
        setLocalIsWatching(previousIsWatching);
        setLocalWatcherIds(previousWatcherIds);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={isToggling || !currentUserId}
        aria-pressed={localIsWatching}
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
      >
        {isToggling ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : localIsWatching ? (
          <Eye className="size-3.5" aria-hidden="true" />
        ) : (
          <EyeOff className="size-3.5" aria-hidden="true" />
        )}
        {localIsWatching ? "Watching" : "Watch"}
      </Button>
      {people.length > 0 ? (
        <UserAvatarGroup
          people={people}
          size="sm"
          ariaLabelPrefix="Watching"
        />
      ) : (
        <span className="text-xs text-muted-foreground">
          No watchers yet.
        </span>
      )}
    </div>
  );
}
