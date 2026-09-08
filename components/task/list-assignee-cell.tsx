"use client";

// F250 (AS-484, AS-485, AS-487): inline assignee editor for a task row in
// the project List view. Same smallest-possible-client-boundary
// convention as its priority/status/due-date siblings.
//
// Reuses the exact multi-select popover markup/behaviour of the task
// detail sheet's own Assignees control (components/task/task-
// detail-sheet.tsx's handleAssigneesToggle + its Popover/PopoverTrigger/
// PopoverContent block, F161: AS-287/AS-288) rather than a bespoke
// version — a focusable trigger button opens the popover, and each
// member row inside is itself a focusable, checkable button (not a
// hover-only affordance), satisfying AS-487 the same way that control
// already does. Calls `setTaskAssignees` (lib/actions/tasks.ts, F160),
// the SAME Server Action, with the full next assignee set (add/remove
// both reduce to "here is the new set").
//
// This field is a SET, not a scalar, so it doesn't go through
// lib/hooks/use-inline-field-edit.ts (see that file's own doc comment) —
// it hand-writes the same optimistic-update / revert-on-failure /
// single-toast shape directly, matching TagsEditor's `persist` and
// ListStatusSelect's `handleChange`.
//
// Data (perf budget): `members` is the SAME workspace-members list
// already fetched once by the List page and threaded through
// TaskListTable to TaskDetailSheet — no new per-row or per-cell query.
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setTaskAssignees } from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import type { TaskDetailSheetMember } from "@/components/task/task-detail-sheet";
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function memberLabel(member: TaskDetailSheetMember): string {
  return member.name || member.email || member.userId;
}

export function ListAssigneeCell({
  taskId,
  assigneeIds,
  members,
}: {
  taskId: string;
  /** Current resolved assignee set for this row — already computed by
   * TaskListTable's own `resolvedAssignees` fallback (assigneeIds, or the
   * single legacy assigneeId). */
  assigneeIds: string[];
  members: TaskDetailSheetMember[];
}) {
  const membership = useMembership();
  const canEdit = membership ? canWrite({ role: membership.role }) : true;
  const disabledTitle = canEdit
    ? undefined
    : "You don't have permission to change this task's assignees.";

  const [localIds, setLocalIds] = useState(assigneeIds);
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isSaving, startSaveTransition] = useTransition();
  // F251 (AS-488): another user's assignee edit reconciled via Realtime
  // (see components/task/use-list-realtime.ts) arrives as a fresh
  // `assigneeIds` prop for this same task. Same no-clobber rule as
  // lib/hooks/use-inline-field-edit.ts: never applied while THIS client
  // has a toggle in flight (`isSaving`) — that request's own resolution
  // (below) is the authoritative outcome for this client's action either
  // way.
  const assigneeKey = assigneeIds.slice().sort().join(",");
  const [lastSeenKey, setLastSeenKey] = useState(assigneeKey);

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalIds(assigneeIds);
    setLastSeenKey(assigneeKey);
  } else if (assigneeKey !== lastSeenKey) {
    setLastSeenKey(assigneeKey);
    if (!isSaving) {
      setLocalIds(assigneeIds);
    }
  }

  function toggle(userId: string) {
    const previousIds = localIds;
    const nextIds = previousIds.includes(userId)
      ? previousIds.filter((id) => id !== userId)
      : [...previousIds, userId];

    setLocalIds(nextIds);
    startSaveTransition(async () => {
      const result = await setTaskAssignees(taskId, nextIds);
      if (result.ok) {
        setLocalIds(result.data.assigneeIds);
      } else {
        // Revert optimistic update on failure.
        setLocalIds(previousIds);
        toast.error(result.error);
      }
    });
  }

  const currentPeople: UserAvatarPerson[] = localIds.map((id) => {
    const member = members.find((m) => m.userId === id);
    return {
      id,
      name: member?.name ?? null,
      email: member?.email ?? null,
      avatarUrl: member?.avatarUrl ?? null,
    };
  });

  // F251 (AS-489): viewer/guest gets a plain, non-interactive row — no
  // popover trigger at all — see list-priority-select.tsx's identical
  // comment for the rationale.
  if (!canEdit) {
    return (
      <div className="flex h-8 w-full max-w-48 items-center gap-2 px-2 text-mini">
        {currentPeople.length > 0 ? (
          <>
            <UserAvatarGroup people={currentPeople} size="sm" />
            <span className="truncate text-muted-foreground">
              {currentPeople.length === 1
                ? currentPeople[0]!.name ||
                  currentPeople[0]!.email ||
                  currentPeople[0]!.id
                : `${currentPeople.length} assignees`}
            </span>
          </>
        ) : (
          <span className="text-micro text-muted-foreground">Unassigned</span>
        )}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={isSaving || !canEdit}
            title={disabledTitle}
            aria-label={`Change assignees for task ${taskId}`}
            className="flex h-8 w-full max-w-48 items-center gap-2 rounded-md border border-transparent px-2 text-mini hover:border-input hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        }
      >
        {currentPeople.length > 0 ? (
          <>
            {/* BUGFIX: interactive=false — this renders inside the
                PopoverTrigger button immediately above; UserAvatarGroup's
                default per-avatar Tooltip renders a real <button> each,
                which is invalid HTML nested inside another <button> and
                was crashing hydration for every row with an assignee (see
                UserAvatarGroup's own doc comment for the full story). The
                popover this trigger opens already names every assignee,
                so the per-avatar hover tooltip was redundant here anyway. */}
            <UserAvatarGroup people={currentPeople} size="sm" interactive={false} />
            <span className="truncate text-muted-foreground">
              {currentPeople.length === 1
                ? currentPeople[0]!.name ||
                  currentPeople[0]!.email ||
                  currentPeople[0]!.id
                : `${currentPeople.length} assignees`}
            </span>
          </>
        ) : (
          <span className="text-micro text-muted-foreground">Unassigned</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {members.length === 0 && (
            <p className="px-2 py-1.5 text-mini text-muted-foreground">
              No workspace members.
            </p>
          )}
          {members.map((member) => {
            const checked = localIds.includes(member.userId);
            return (
              <button
                key={member.userId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                disabled={isSaving || !canEdit}
                onClick={() => toggle(member.userId)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-mini hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" />
                <UserAvatar
                  person={{
                    id: member.userId,
                    name: member.name,
                    email: member.email,
                    avatarUrl: member.avatarUrl,
                  }}
                  size="sm"
                />
                <span className="truncate">{memberLabel(member)}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
