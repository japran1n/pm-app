"use client";

// F150 (AS-263, AS-264): task detail's Subtasks section — inline
// add-subtask input, child rows with a status chip and assignee avatar,
// and a "N of M done" completion count.
//
// Pattern: same deviation from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") that components/task/comment-list.tsx (F060) and
// components/task/attachment-list.tsx (F066) document — this component is
// composed *inside* components/task/task-detail-sheet.tsx (F039), which is
// already a Client Component. The caller (getTaskDetail, via
// TaskDetailSheet) fetches the task's initial children in the SAME query
// that fetches the task itself (lib/actions/tasks.ts's getTaskDetail —
// see that function's own comment for why: "fetch it with the existing
// task detail query rather than a per-child round trip") and passes them
// down as `children`; this component owns rendering plus the add-subtask
// form's interactive state, appending a newly-created subtask to local
// state (optimistic-append via the pure lib/tasks/append-subtask.ts,
// matching CommentList/AttachmentList's identical convention) rather than
// re-fetching.
//
// AS-264's completion count ("3 of 5 done") is computed by the pure
// lib/tasks/subtask-progress.ts (see that file's doc comment for why
// "done" is today's fixed status value, and which future feature — F222 —
// is expected to replace that check once custom statuses exist).
//
// Quick-add interaction pattern: deliberately mirrors CommentList's
// add-comment form (a single Input + submit Button, Enter-to-submit via
// the native <form>, disabled while submitting, cleared on success,
// toast.error on failure) rather than inventing a new one — this
// feature's clarification explicitly calls for reusing "the quick-add
// interaction pattern" so adding a subtask feels the same as the rest of
// this Sheet's own add-item forms, and F248 (not yet built) is expected to
// formalise a single shared quick-add primitive across the app later.
//
// Mutation: calls createTask (lib/actions/tasks.ts, F149) directly with
// `parentTaskId` set to this section's own taskId — no parallel
// create-subtask action exists or is needed, since F149 already extended
// createTask for exactly this. createTask independently re-validates
// membership and the parent/child invariants server-side (defense in
// depth), so this form performs no membership/permission check of its
// own beyond disabling itself when `projectId` is unavailable.
//
// Access control note (Decisions made, F150 handoff): the clarified
// spec's default access-control answer names `lib/auth/permissions.ts` as
// the single source of truth for hiding/disabling controls a user lacks
// rights for — that module does not exist yet in this codebase (it is
// AS-230's own not-yet-built feature). Rather than introduce it here out
// of this feature's scope, this form follows the SAME convention every
// sibling add-item form in this Sheet already uses today
// (CommentList/AttachmentList): available to any active workspace member,
// server-side re-verified by the Server Action itself. See the handoff's
// Decisions made for the full rationale.

import { useState, useTransition } from "react";
import { Loader2, ListTree } from "lucide-react";
import { toast } from "sonner";

import { createTask } from "@/lib/actions/tasks";
import { appendSubtask } from "@/lib/tasks/append-subtask";
import { countSubtaskProgress } from "@/lib/tasks/subtask-progress";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/task-colors";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";

export type SubtaskListChildTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  assigneeId: string | null;
  /** F146 (AS-258)-style task key badge. A subtask always belongs to the
   * SAME project as its parent (F148's enforce_task_parent_rules()
   * invariant), so this is always the current task's own projectKey,
   * threaded through by getTaskDetail — not a second per-child join. */
  projectKey?: string;
  number?: number;
};

export type SubtaskListMember = {
  userId: string;
  email: string | null;
  name: string | null;
  avatarUrl?: string | null;
};

function assigneeOf(
  userId: string,
  members: SubtaskListMember[],
): UserAvatarPerson {
  const member = members.find((m) => m.userId === userId);
  return {
    id: userId,
    email: member?.email ?? null,
    name: member?.name ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

export function SubtaskList({
  taskId,
  projectId,
  childTasks,
  members,
  onOpenTask,
}: {
  /** The parent task this Subtasks section belongs to. */
  taskId: string;
  /** F150: needed to call createTask for the add-subtask form. Optional
   * so a caller that hasn't been updated yet (existing tests/fixtures)
   * still renders — the add-subtask input is simply disabled rather than
   * crashing, same "safe default" convention as every other optional
   * field on TaskDetailSheetTask. */
  projectId?: string;
  /** This task's current children, from getTaskDetail's own query.
   * Named `childTasks` (not `children`) to avoid colliding with React's
   * own special `children` prop convention. */
  childTasks: SubtaskListChildTask[];
  /** Workspace members, used to resolve each child's assignee avatar —
   * reuses the SAME members list TaskDetailSheet already receives and
   * passes to CommentList/AttachmentList, never a second fetch. */
  members: SubtaskListMember[];
  /** F150 (AS-263): opens another task (a child row, here) in the same
   * Sheet. Passed straight through from TaskDetailSheet's own prop of the
   * same name — undefined rows render as plain (non-interactive) rows
   * instead of crashing, matching TaskCard's own optional-onClick
   * convention. */
  onOpenTask?: (taskId: string) => void;
}) {
  const [localChildren, setLocalChildren] = useState(childTasks);
  // Tracks which task's children are currently loaded into local state, so
  // it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as CommentList's
  // syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [draft, setDraft] = useState("");
  const [isSubmitting, startSubmitTransition] = useTransition();

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalChildren(childTasks);
    setDraft("");
  }

  const progress = countSubtaskProgress(localChildren);

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !projectId) return;

    startSubmitTransition(async () => {
      const result = await createTask(
        projectId,
        trimmed,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        taskId,
      );
      if (result.ok) {
        setLocalChildren((previous) =>
          appendSubtask(previous, {
            id: result.data.id,
            title: result.data.title,
            status: result.data.status as SubtaskListChildTask["status"],
            assigneeId: result.data.assigneeId,
          }),
        );
        setDraft("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Subtasks</Label>
        {progress.total > 0 && (
          <span className="text-xs text-muted-foreground">
            {progress.done} of {progress.total} done
          </span>
        )}
      </div>

      {localChildren.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListTree className="size-4" aria-hidden="true" />
          No subtasks yet. Add one below.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {localChildren.map((child) => {
            const assignee = child.assigneeId
              ? assigneeOf(child.assigneeId, members)
              : null;
            const childKey = formatTaskKey(child.projectKey, child.number);

            return (
              <li
                key={child.id}
                role={onOpenTask ? "button" : undefined}
                tabIndex={onOpenTask ? 0 : undefined}
                onClick={onOpenTask ? () => onOpenTask(child.id) : undefined}
                onKeyDown={
                  onOpenTask
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenTask(child.id);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex items-center gap-2 rounded-md px-1.5 py-1",
                  onOpenTask &&
                    "cursor-pointer hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                )}
              >
                {childKey && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {childKey}
                  </span>
                )}
                <span className="flex-1 truncate text-sm">{child.title}</span>
                {/* AS-153 convention (color never stands alone): status is
                    a text label alongside its dot, same pattern as
                    TaskCard's priority badge. */}
                <Badge variant="secondary" className="gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[child.status] }}
                  />
                  {STATUS_LABELS[child.status]}
                </Badge>
                {assignee && <UserAvatar person={assignee} size="sm" />}
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex gap-2"
        aria-label="Add a subtask"
      >
        <Label htmlFor={`subtask-draft-${taskId}`} className="sr-only">
          Add a subtask
        </Label>
        <Input
          id={`subtask-draft-${taskId}`}
          value={draft}
          disabled={isSubmitting || !projectId}
          placeholder="Add a subtask…"
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
        />
        <Button
          type="submit"
          disabled={isSubmitting || !draft.trim() || !projectId}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            "Add"
          )}
        </Button>
      </form>
    </div>
  );
}
