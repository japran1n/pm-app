import { ListTodo } from "lucide-react";

import {
  NewTaskDialog,
  type NewTaskDialogAssigneeOption,
} from "@/components/task/new-task-dialog";

// F032 (AS-041): the empty state shown on a project's Board view when it
// has zero tasks. Built as a reusable component (not inline JSX) because
// F042+ (real board render) needs the same empty state once the board has
// real column/task data but the *project* still has no tasks yet — F042
// composes this component rather than duplicating its markup.
//
// The "Create task" trigger used to be a permanently disabled button
// (createTask didn't exist until F035) with a comment noting a future
// worker should wire it up once F035 landed — that follow-up never
// happened, leaving the app with no way to create a task anywhere in the
// UI. Fixed here: this now renders the real <NewTaskDialog> (F035's
// createTask, wired up), passed the projectId (and workspace member
// options, for the dialog's optional assignee field) from the board page.
//
// Stays a plain Server Component itself — the interactive part is fully
// contained in <NewTaskDialog>'s own "use client" boundary, matching this
// repo's smallest-possible-client-boundary convention.
export function BoardEmptyState({
  projectId,
  assigneeOptions,
}: {
  projectId: string;
  assigneeOptions: NewTaskDialogAssigneeOption[];
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted"
      >
        <ListTodo className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No tasks yet in this project</p>
        <p className="text-sm text-muted-foreground">
          Create your first task to start tracking work on the board.
        </p>
      </div>
      <NewTaskDialog
        projectId={projectId}
        assigneeOptions={assigneeOptions}
        triggerLabel="Create task"
      />
    </div>
  );
}
