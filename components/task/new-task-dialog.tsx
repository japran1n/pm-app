"use client";

// New task creation dialog. Mirrors components/new-project-dialog.tsx's
// pattern (smallest possible client boundary): the caller — a Server
// Component page/route (board or list) — fetches workspace members and
// passes them down as `assigneeOptions`; this component only owns the
// interactive form and calls the already-implemented `createTask` Server
// Action (lib/actions/tasks.ts, F035).
//
// Fixes the "no way to create a task anywhere in the UI" gap: previously
// board-empty-state.tsx shipped a permanently-disabled button with a
// "coming soon" label and a comment noting a future worker should wire it
// up once createTask (F035) landed — that follow-up never happened. This
// component is that follow-up, wired into three places: the board empty
// state, the board toolbar (visible once tasks already exist), and the
// list view toolbar.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createTask, setTaskAssignees } from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// F122 (AS-214): "assignee pickers" includes this dialog's own assignee
// control — `label` is already the resolved display name/email/id (see
// the callers of this type), so UserAvatar is handed `{ name: label }`
// rather than duplicating that fallback logic here.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
// F161 (AS-287, AS-288): stacked avatar group for the trigger once more
// than one assignee is selected.
import { UserAvatarGroup } from "@/components/user-avatar-group";
// F244 (AS-467, AS-471): react to the global `n` shortcut for THIS
// project, and register this dialog as a closeable Escape layer while
// open.
import {
  SHORTCUT_EVENTS,
  useEscapeLayer,
  type NewTaskShortcutDetail,
} from "@/lib/hooks/use-shortcut";

export type NewTaskDialogAssigneeOption = {
  id: string;
  label: string;
  avatarUrl?: string | null;
};

type Priority = "urgent" | "high" | "medium" | "low" | "backlog";

const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

// Same "reserved sentinel value for the no-op choice" convention already
// used by list-filters.tsx (ALL_VALUE) and task-detail-sheet.tsx
// (NO_PRIORITY_VALUE / NO_ASSIGNEE_VALUE) — base-ui's Select doesn't accept
// an empty-string item value.
const NO_PRIORITY_VALUE = "__none__";

const PRIORITY_SELECT_LABELS: Record<string, string> = {
  [NO_PRIORITY_VALUE]: "No priority",
  ...PRIORITY_LABELS,
};

export function NewTaskDialog({
  projectId,
  assigneeOptions,
  variant = "default",
  size = "default",
  triggerLabel = "New Task",
}: {
  projectId: string;
  assigneeOptions: NewTaskDialogAssigneeOption[];
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  triggerLabel?: string;
}) {
  const router = useRouter();
  // F135 (AS-231): read from the shared membership context rather than a
  // per-caller prop — this dialog is mounted straight from the board
  // toolbar/empty state and the list toolbar, none of which otherwise
  // fetch or thread a role through to here. `null` (no provider in the
  // tree, e.g. an existing test) is treated as permissive, matching the
  // rest of this codebase's optional-role convention.
  const membership = useMembership();
  const canCreate = membership ? canWrite({ role: membership.role }) : true;
  const createDisabledTitle = canCreate
    ? undefined
    : "You don't have permission to create tasks.";
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>(NO_PRIORITY_VALUE);
  // F161 (AS-287, AS-288): multi-select — replaces the old single
  // `assigneeId` string state. Empty array means "unassigned", same
  // meaning `NO_ASSIGNEE_VALUE` used to carry.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const assigneeLabels: Record<string, string> = {};
  const assigneeAvatarUrls: Record<string, string | null> = {};
  for (const option of assigneeOptions) {
    assigneeLabels[option.id] = option.label;
    assigneeAvatarUrls[option.id] = option.avatarUrl ?? null;
  }

  function toggleAssignee(userId: string) {
    setAssigneeIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority(NO_PRIORITY_VALUE);
    setAssigneeIds([]);
    setDueDate("");
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

  // F244 (AS-471): register as the topmost Escape layer for as long as
  // this dialog is open — Escape closes THIS dialog (and only this one,
  // even if something else is also registered) rather than every open
  // layer at once. Reuses `handleOpenChange` (not a raw `setOpen`) so
  // Escape resets the form exactly like any other close path.
  useEscapeLayer(open, () => handleOpenChange(false));

  // F244 (AS-467): `n`, fired from anywhere under this project's board/
  // list route, opens THIS project's new-task dialog — matched by
  // `projectId` so a shortcut fired while looking at project A never pops
  // open project B's (unmounted, off-screen) dialog.
  useEffect(() => {
    function onShortcutNewTask(event: Event) {
      const detail = (event as CustomEvent<NewTaskShortcutDetail>).detail;
      if (!detail || detail.projectId !== projectId) return;
      if (!canCreate) return;
      setOpen(true);
    }

    window.addEventListener(SHORTCUT_EVENTS.newTask, onShortcutNewTask);
    return () =>
      window.removeEventListener(SHORTCUT_EVENTS.newTask, onShortcutNewTask);
  }, [projectId, canCreate]);

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Task title is required.");
      return;
    }

    startTransition(async () => {
      const result = await createTask(
        projectId,
        trimmedTitle,
        description.trim() || null,
        "todo",
        priority !== NO_PRIORITY_VALUE ? (priority as Priority) : null,
        // AS-052/legacy mirror: `createTask` only ever writes ONE
        // assignee into `tasks.assignee_id` directly (it predates F160's
        // `task_assignees` table and is out of this feature's Files
        // scope to rewrite) — the first selected assignee is passed here
        // so a brand-new task still has a non-empty legacy mirror the
        // moment it's created, matching `setTaskAssigneesCore`'s own
        // "always mirror the first assignee" rule (F160's handoff).
        assigneeIds[0] ?? null,
        dueDate || null,
      );

      if (result.ok) {
        // F161 (AS-287, AS-288): when more than one assignee was picked,
        // write the FULL set through the shared `setTaskAssignees` write
        // path (F160) right after creation — `createTask`'s own single
        // `assigneeId` param above already covers the one-assignee case,
        // so this second call only fires when it's actually needed
        // (never a redundant write for a 0- or 1-assignee task).
        if (assigneeIds.length > 1) {
          const assigneesResult = await setTaskAssignees(
            result.data.id,
            assigneeIds,
          );
          if (!assigneesResult.ok) {
            toast.error(
              `${result.data.title} created, but assignees couldn't be saved: ${assigneesResult.error}`,
            );
            setOpen(false);
            resetForm();
            router.refresh();
            return;
          }
        }
        toast.success(`${result.data.title} created.`);
        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            className="gap-1.5"
            disabled={!canCreate}
            title={createDisabledTitle}
          >
            <Plus className="size-4" aria-hidden="true" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>
            Give your task a title. You can fill in the rest now or later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              name="title"
              required
              disabled={isPending}
              value={title}
              onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "task-title-error" : undefined}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="task-description">Description (optional)</Label>
            <Textarea
              id="task-description"
              name="description"
              disabled={isPending}
              value={description}
              onChange={(changeEvent) =>
                setDescription(changeEvent.target.value)
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-priority">Priority (optional)</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value ?? NO_PRIORITY_VALUE)}
                disabled={isPending}
              >
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue>
                    {(value: string) => PRIORITY_SELECT_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRIORITY_VALUE}>No priority</SelectItem>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label id="task-assignees-label">Assignees (optional)</Label>
              {/* F161 (AS-287, AS-288): multi-select assignee picker —
                  replaces the old single-value Select, same Popover +
                  checkable-row pattern as task-detail-sheet.tsx's own
                  picker. */}
              {(() => {
                const selectedPeople: UserAvatarPerson[] = assigneeIds.map(
                  (id) => ({
                    id,
                    name: assigneeLabels[id] ?? id,
                    avatarUrl: assigneeAvatarUrls[id] ?? null,
                  }),
                );
                return (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          id="task-assignee"
                          aria-labelledby="task-assignees-label"
                          disabled={isPending}
                          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      }
                    >
                      {selectedPeople.length > 0 ? (
                        <>
                          <UserAvatarGroup people={selectedPeople} size="sm" />
                          <span className="truncate text-muted-foreground">
                            {selectedPeople.length === 1
                              ? assigneeLabels[selectedPeople[0]!.id]
                              : `${selectedPeople.length} assignees`}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Unassigned
                        </span>
                      )}
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-64 p-1">
                      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                        {assigneeOptions.length === 0 && (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">
                            No workspace members.
                          </p>
                        )}
                        {assigneeOptions.map((option) => {
                          const checked = assigneeIds.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={checked}
                              disabled={isPending}
                              onClick={() => toggleAssignee(option.id)}
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Checkbox
                                checked={checked}
                                tabIndex={-1}
                                aria-hidden="true"
                              />
                              <UserAvatar
                                person={{
                                  id: option.id,
                                  name: option.label,
                                  avatarUrl: option.avatarUrl,
                                }}
                                size="sm"
                              />
                              <span className="truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })()}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="task-due-date">Due date (optional)</Label>
            <Input
              id="task-due-date"
              name="dueDate"
              type="date"
              disabled={isPending}
              value={dueDate}
              onChange={(changeEvent) => setDueDate(changeEvent.target.value)}
            />
          </div>

          {error && (
            <p
              id="task-title-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                "Create Task"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
