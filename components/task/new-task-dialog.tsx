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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createTask } from "@/lib/actions/tasks";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type NewTaskDialogAssigneeOption = {
  id: string;
  label: string;
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
const NO_ASSIGNEE_VALUE = "__unassigned__";

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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>(NO_PRIORITY_VALUE);
  const [assigneeId, setAssigneeId] = useState<string>(NO_ASSIGNEE_VALUE);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const assigneeLabels: Record<string, string> = {
    [NO_ASSIGNEE_VALUE]: "Unassigned",
  };
  for (const option of assigneeOptions) {
    assigneeLabels[option.id] = option.label;
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority(NO_PRIORITY_VALUE);
    setAssigneeId(NO_ASSIGNEE_VALUE);
    setDueDate("");
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

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
        assigneeId !== NO_ASSIGNEE_VALUE ? assigneeId : null,
        dueDate || null,
      );

      if (result.ok) {
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
          <Button variant={variant} size={size} className="gap-1.5">
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
              <Label htmlFor="task-assignee">Assignee (optional)</Label>
              <Select
                value={assigneeId}
                onValueChange={(value) =>
                  setAssigneeId(value ?? NO_ASSIGNEE_VALUE)
                }
                disabled={isPending}
              >
                <SelectTrigger id="task-assignee" className="w-full">
                  <SelectValue>
                    {(value: string) => assigneeLabels[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE_VALUE}>Unassigned</SelectItem>
                  {assigneeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
