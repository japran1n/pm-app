"use client";

// F039: reusable task detail Sheet. Foundation/skeleton feature (no
// assertions assigned) — the goal is a clean, self-contained component
// ready to be opened by a real task card once one exists (F042's board,
// F053's list). There is no board/list rendering real task cards yet, so
// this file exports the Sheet plus its prop/data types and does not wire
// itself to any route.
//
// Pattern: smallest-possible-client-boundary, matching
// components/edit-project-dialog.tsx and components/member-role-select.tsx
// — the caller (a future Server Component page) fetches the task and its
// workspace's members and passes them down as props; this component only
// owns the interactive editing surface. `lib/queries/members.ts` (F017)
// already has the `getWorkspaceMembers` Server-only query used to build
// the `members` prop — it isn't called from here because this file must
// stay a Client Component and that query uses the Auth Admin client.
//
// Calls the F033-F038 Server Actions directly (editTask, assignTask,
// deleteTask) — Server Actions are safe to import and call from a Client
// Component. `status` currently has no Server Action support (editTask's
// `EditTaskUpdates` covers title/description/priority/dueDate only — see
// lib/validation/tasks.ts), so the status Select is rendered but disabled
// with an explanatory label rather than silently no-op persisting a value;
// this is a documented limitation for a future feature to lift once a
// changeTaskStatus (or equivalent) action exists, not an oversight.
//
// The four states called for by the clarified spec (loading, populated,
// empty, error) are all handled explicitly even though this component
// does not fetch its own data: `loading` and `error` are optional props a
// future data-fetching caller can drive; `task === null` while `open` is
// true is the empty state (should not normally happen, since a caller
// should only open the sheet once it has a task, but is handled rather
// than left to crash).

import { useState, useTransition } from "react";
import { Loader2, TriangleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { assignTask, deleteTask, editTask } from "@/lib/actions/tasks";
import { isOverdue } from "@/lib/tasks/is-overdue";
import { cn } from "@/lib/utils";
import type { EditTaskUpdates } from "@/lib/validation/tasks";
import { TagsEditor } from "@/components/task/tags-editor";
import { CommentList, type TaskComment } from "@/components/task/comment-list";
import {
  AttachmentList,
  type TaskAttachment,
} from "@/components/task/attachment-list";
import {
  TimeTracking,
  type TimeEntry,
  type TimeTrackingActiveTimer,
} from "@/components/task/time-tracking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
// F122 (AS-214): "assignee pickers" includes this Sheet's own assignee
// Select.
import { UserAvatar } from "@/components/user-avatar";

export type TaskDetailSheetTask = {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "in_review" | "done";
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  assigneeId: string | null;
  dueDate: string | null;
  /** AS-065: may be empty — every task has a tag list, never null. */
  tags: string[];
};

export type TaskDetailSheetMember = {
  userId: string;
  email: string | null;
  name: string | null;
  /** F122 (AS-214): optional so existing callers (tests, callers not yet
   * updated) don't have to pass it — a missing avatarUrl just means the
   * initials fallback renders instead of an image. */
  avatarUrl?: string | null;
};

const STATUS_LABELS: Record<TaskDetailSheetTask["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

const PRIORITY_LABELS: Record<
  NonNullable<TaskDetailSheetTask["priority"]>,
  string
> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

const NO_PRIORITY_VALUE = "__none__";
const NO_ASSIGNEE_VALUE = "__unassigned__";

function memberLabel(member: TaskDetailSheetMember): string {
  return member.name || member.email || member.userId;
}

export function TaskDetailSheet({
  task,
  members,
  comments = [],
  attachments = [],
  timeEntries = [],
  activeTimer = null,
  open,
  onOpenChange,
  loading = false,
  error = null,
  onRetry,
  onDeleted,
  currentUserId,
  currentUserRole,
  timezone = "UTC",
}: {
  /** The task to display, or null (empty state) if none is loaded. */
  task: TaskDetailSheetTask | null;
  /** Workspace members eligible as assignees (from getWorkspaceMembers). */
  members: TaskDetailSheetMember[];
  /** F060: task's comments (from lib/queries/comments.ts's getTaskComments),
   * ideally already oldest-first. Defaults to empty — a caller that hasn't
   * been updated to fetch comments yet still renders a valid empty state
   * rather than crashing. */
  comments?: TaskComment[];
  /** F066: task's attachments (from a future getTaskAttachments query).
   * Defaults to empty — a caller that hasn't been updated yet still
   * renders a valid empty state rather than crashing. */
  attachments?: TaskAttachment[];
  /** F113 (AS-171): task's time entries (a future getTaskTimeEntries query
   * would fetch these). Defaults to empty — a caller that hasn't been
   * updated yet still renders a valid empty state rather than crashing. */
  timeEntries?: TimeEntry[];
  /** F113: the viewer's own active timer, if any, from F111's
   * getActiveTimer. Defaults to null (no active timer) when the caller
   * hasn't fetched it yet. */
  activeTimer?: TimeTrackingActiveTimer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Drives the loading skeleton when a future caller is still fetching. */
  loading?: boolean;
  /** Drives the inline error state when a future caller's fetch failed. */
  error?: string | null;
  onRetry?: () => void;
  /** Called after a successful delete so the caller can close/refresh. */
  onDeleted?: (taskId: string) => void;
  /** F061: the viewer's own user id, used by CommentList to show a delete
   * affordance on their own comments (AS-098). Undefined (caller hasn't
   * been updated yet) hides the delete affordance entirely — a safe
   * default, since the server independently re-checks authorization
   * regardless (AS-099). */
  currentUserId?: string;
  /** F061: the viewer's active role in this task's workspace, used by
   * CommentList to show a delete affordance on *any* comment for
   * admin/owner (AS-100). */
  currentUserRole?: "owner" | "admin" | "member";
  /** F124 (AS-207): the viewer's IANA timezone, resolved once per request
   * by the caller's Server Component page (board/page.tsx, list/page.tsx —
   * via lib/queries/profile.ts's getCurrentUserTimezone) and passed
   * through here, never fetched by this Client Component. Defaults to
   * "UTC" for callers that haven't been updated yet (e.g. tests), same
   * "safe default" convention as `currentUserId`/`activeTimer` above. */
  timezone?: string;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  // Tracks which task's fields are currently loaded into local edit state,
  // so it can be re-synced below without an Effect (React docs: "adjusting
  // state when a prop changes" is done during render, not in a useEffect,
  // to avoid the extra cascading render an Effect would cause).
  const [syncedTaskId, setSyncedTaskId] = useState<string | null>(null);
  const [isSavingField, startSaveTransition] = useTransition();
  const [isAssigning, startAssignTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  // Re-sync local edit state whenever the sheet is opened for a (possibly
  // different) task, mirroring EditProjectDialog's handleOpenChange reset
  // convention.
  if (open && task && task.id !== syncedTaskId) {
    setSyncedTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setDueDate(task.dueDate ?? "");
  } else if (!open && syncedTaskId !== null) {
    // Sheet closed — clear the sync marker so reopening the same task
    // (e.g. after an external update) re-syncs from the latest props.
    setSyncedTaskId(null);
  }

  function saveField(updates: EditTaskUpdates, successMessage: string) {
    if (!task) return;
    startSaveTransition(async () => {
      const result = await editTask(task.id, updates);
      if (result.ok) {
        toast.success(successMessage);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleTitleBlur() {
    if (!task) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) {
      setTitle(task.title);
      return;
    }
    saveField({ title: trimmed }, "Title updated.");
  }

  function handleDescriptionBlur() {
    if (!task) return;
    const next = description.trim() || null;
    if (next === (task.description ?? null)) return;
    saveField({ description: next }, "Description updated.");
  }

  function handlePriorityChange(value: string | null) {
    if (!task) return;
    const next =
      value && value !== NO_PRIORITY_VALUE
        ? (value as NonNullable<TaskDetailSheetTask["priority"]>)
        : null;
    if (next === task.priority) return;
    saveField({ priority: next }, "Priority updated.");
  }

  function handleDueDateChange(value: string) {
    setDueDate(value);
    if (!task) return;
    const next = value || null;
    if (next === (task.dueDate ?? null)) return;
    saveField({ dueDate: next }, "Due date updated.");
  }

  function handleAssigneeChange(value: string | null) {
    if (!task) return;
    const next = value && value !== NO_ASSIGNEE_VALUE ? value : null;
    if (next === task.assigneeId) return;
    startAssignTransition(async () => {
      const result = await assignTask(task.id, next);
      if (result.ok) {
        toast.success(next ? "Assignee updated." : "Task unassigned.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    startDeleteTransition(async () => {
      const result = await deleteTask(task.id);
      if (result.ok) {
        toast.success("Task deleted.");
        onOpenChange(false);
        onDeleted?.(task.id);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {loading ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Loading task…</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : error ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Couldn&apos;t load task</SheetTitle>
              <SheetDescription>{error}</SheetDescription>
            </SheetHeader>
            {onRetry && (
              <Button variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        ) : !task ? (
          <div className="flex flex-col gap-2 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>No task selected</SheetTitle>
              <SheetDescription>
                Select a task to see its details here.
              </SheetDescription>
            </SheetHeader>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Task details</SheetTitle>
              <SheetDescription className="sr-only">
                View and edit this task&apos;s title, description, status,
                priority, assignee, and due date.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 overflow-y-auto px-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`task-title-${task.id}`}>Title</Label>
                <Input
                  id={`task-title-${task.id}`}
                  value={title}
                  disabled={isSavingField}
                  onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                  onBlur={handleTitleBlur}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`task-description-${task.id}`}>
                  Description
                </Label>
                <Textarea
                  id={`task-description-${task.id}`}
                  value={description}
                  disabled={isSavingField}
                  onChange={(changeEvent) =>
                    setDescription(changeEvent.target.value)
                  }
                  onBlur={handleDescriptionBlur}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`task-status-${task.id}`}>Status</Label>
                  {/* No Server Action currently persists task status
                      changes (editTask covers title/description/priority/
                      dueDate only — see lib/validation/tasks.ts). Disabled
                      rather than silently discarding a change the user
                      thinks was saved; a future feature should add a
                      changeTaskStatus action and enable this control. */}
                  <Select value={task.status} disabled>
                    <SelectTrigger
                      id={`task-status-${task.id}`}
                      aria-label="Status (read-only until status editing ships)"
                      className="w-full"
                    >
                      <SelectValue>
                        {(value: string) =>
                          STATUS_LABELS[value as keyof typeof STATUS_LABELS] ??
                          value
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`task-priority-${task.id}`}>Priority</Label>
                  <Select
                    value={task.priority ?? NO_PRIORITY_VALUE}
                    onValueChange={handlePriorityChange}
                    disabled={isSavingField}
                  >
                    <SelectTrigger
                      id={`task-priority-${task.id}`}
                      className="w-full"
                    >
                      <SelectValue placeholder="No priority">
                        {(value: string) =>
                          value === NO_PRIORITY_VALUE
                            ? "No priority"
                            : (PRIORITY_LABELS[
                                value as keyof typeof PRIORITY_LABELS
                              ] ?? value)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRIORITY_VALUE}>
                        No priority
                      </SelectItem>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`task-assignee-${task.id}`}>Assignee</Label>
                <Select
                  value={task.assigneeId ?? NO_ASSIGNEE_VALUE}
                  onValueChange={handleAssigneeChange}
                  disabled={isAssigning}
                >
                  <SelectTrigger
                    id={`task-assignee-${task.id}`}
                    className="w-full"
                  >
                    {isAssigning ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <SelectValue placeholder="Unassigned">
                        {(value: string) => {
                          if (value === NO_ASSIGNEE_VALUE) return "Unassigned";
                          const member = members.find(
                            (m) => m.userId === value,
                          );
                          return (
                            <span className="flex items-center gap-2">
                              <UserAvatar
                                person={{
                                  id: value,
                                  name: member?.name ?? null,
                                  email: member?.email ?? null,
                                  avatarUrl: member?.avatarUrl ?? null,
                                }}
                                size="sm"
                              />
                              {member ? memberLabel(member) : value}
                            </span>
                          );
                        }}
                      </SelectValue>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ASSIGNEE_VALUE}>
                      Unassigned
                    </SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        <span className="flex items-center gap-2">
                          <UserAvatar
                            person={{
                              id: member.userId,
                              name: member.name,
                              email: member.email,
                              avatarUrl: member.avatarUrl,
                            }}
                            size="sm"
                          />
                          {memberLabel(member)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label
                  htmlFor={`task-due-date-${task.id}`}
                  className={cn(
                    isOverdue(task.dueDate, task.status, timezone) &&
                      "inline-flex items-center gap-1 text-destructive",
                  )}
                >
                  {isOverdue(task.dueDate, task.status, timezone) && (
                    <TriangleAlert className="size-3" aria-hidden="true" />
                  )}
                  Due date
                  {isOverdue(task.dueDate, task.status, timezone) && (
                    <span className="sr-only">(overdue)</span>
                  )}
                </Label>
                <Input
                  id={`task-due-date-${task.id}`}
                  type="date"
                  value={dueDate ?? ""}
                  disabled={isSavingField}
                  onChange={(changeEvent) =>
                    handleDueDateChange(changeEvent.target.value)
                  }
                  className={cn(
                    isOverdue(task.dueDate, task.status, timezone) &&
                      "border-destructive text-destructive",
                  )}
                />
              </div>

              <Separator />

              <TagsEditor taskId={task.id} tags={task.tags} />

              <Separator />

              <CommentList
                taskId={task.id}
                comments={comments}
                members={members}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />

              <Separator />

              <AttachmentList
                taskId={task.id}
                attachments={attachments}
                members={members}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />

              <Separator />

              <TimeTracking
                taskId={task.id}
                timeEntries={timeEntries}
                members={members}
                activeTimer={activeTimer}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />
            </div>

            <SheetFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={handleDelete}
              >
                {isDeleting ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete task
                  </>
                )}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
