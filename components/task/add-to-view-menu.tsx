"use client";

// Follow-up to F227/F228/F229 saved views: lets a user manually add a
// task to a saved view (ClickUp-style "add to list"), independent of
// whatever filter that view has -- lib/actions/view-tasks.ts's
// addTaskToView, backed by `public.view_tasks`
// (supabase/migrations/20260907010000_create_view_tasks.sql).
//
// Renders a compact dropdown of the project's saved list views. This
// intentionally does NOT show a checked/unchecked state per view (that
// would need this project's manual-membership set fetched for every row
// rendered, which the List page does not currently compute) -- clicking
// an entry is idempotent (addTaskToView upserts), so "Add to <view>"
// is always a safe action even if the task is already a member. Full
// checkbox state showing current membership per view is noted as
// follow-up work.

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { addTaskToView } from "@/lib/actions/view-tasks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AddToViewMenu({
  taskId,
  views,
}: {
  taskId: string;
  /** The project's saved list views this task could be manually added to. */
  views: { id: string; name: string }[];
}) {
  const [pendingViewId, setPendingViewId] = useState<string | null>(null);

  if (views.length === 0) {
    return null;
  }

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Add to view"
            onClick={stop}
          >
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" onClick={stop}>
        <DropdownMenuLabel>Add to view</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {views.map((view) => (
          <DropdownMenuItem
            key={view.id}
            disabled={pendingViewId === view.id}
            onClick={async () => {
              setPendingViewId(view.id);
              const result = await addTaskToView({ viewId: view.id, taskId });
              setPendingViewId(null);
              if (result.ok) {
                toast.success(`Added to "${view.name}".`);
              } else {
                toast.error(result.error);
              }
            }}
          >
            {view.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
