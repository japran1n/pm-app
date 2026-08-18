import { ListTodo } from "lucide-react";

import { Button } from "@/components/ui/button";

// F032 (AS-041): the empty state shown on a project's Board view when it
// has zero tasks. Built as a reusable component (not inline JSX) because
// F042+ (real board render) needs the same empty state once the board has
// real column/task data but the *project* still has no tasks yet — F042
// should compose this component rather than duplicate its markup.
//
// Plain Server Component (no "use client"): nothing here is interactive
// yet. The create-task button is intentionally disabled — `createTask`
// doesn't exist until F035, so this button has no action to wire up. Once
// F035 lands, a future worker should replace the disabled button with a
// real trigger (e.g. opening a "new task" dialog) without changing this
// component's exported shape more than necessary.
export function BoardEmptyState() {
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
      <Button disabled aria-label="Create task (coming soon)">
        Create task — coming soon
      </Button>
    </div>
  );
}
