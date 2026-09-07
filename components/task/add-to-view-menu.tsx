"use client";

// Follow-up to F227/F228/F229 saved views: lets a user manually add/remove
// a task from a saved view (ClickUp-style "add to list"), independent of
// whatever filter that view has -- lib/actions/view-tasks.ts's
// addTaskToView/removeTaskFromView, backed by `public.view_tasks`
// (supabase/migrations/20260907010000_create_view_tasks.sql).
//
// Renders a compact dropdown of the project's saved list views, WITH a
// checkmark next to any view the task is already a manual member of
// (fetched lazily via listViewTaskIds only when the dropdown is first
// opened, one call per view -- not on every row render for every view up
// front, which would be O(rows * views) queries on page load). Clicking a
// checked entry now REMOVES the task from that view; clicking an unchecked
// entry ADDS it. This replaces the previous "always safe to click, never
// shows current state" version noted as follow-up work in that pass.

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";

import { addTaskToView, listViewTaskIds, removeTaskFromView } from "@/lib/actions/view-tasks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  // View ids this task is currently a manual member of. `null` = not
  // loaded yet (dropdown never opened, or still loading) -- rendered as
  // "no checkmark yet" rather than blocking the menu from opening.
  const [memberViewIds, setMemberViewIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);

  if (views.length === 0) {
    return null;
  }

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  async function loadMembership() {
    if (memberViewIds !== null || loading) return;
    setLoading(true);
    const results = await Promise.all(
      views.map(async (view) => {
        const result = await listViewTaskIds(view.id);
        return result.ok && result.data.includes(taskId) ? view.id : null;
      }),
    );
    setMemberViewIds(new Set(results.filter((id): id is string => id !== null)));
    setLoading(false);
  }

  async function toggleView(viewId: string, viewName: string, isMember: boolean) {
    setPendingViewId(viewId);
    const result = isMember
      ? await removeTaskFromView({ viewId, taskId })
      : await addTaskToView({ viewId, taskId });
    setPendingViewId(null);
    if (result.ok) {
      setMemberViewIds((current) => {
        const next = new Set(current ?? []);
        if (isMember) {
          next.delete(viewId);
        } else {
          next.add(viewId);
        }
        return next;
      });
      toast.success(isMember ? `Removed from "${viewName}".` : `Added to "${viewName}".`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void loadMembership();
      }}
    >
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
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add to view</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {views.map((view) => {
            const isMember = memberViewIds?.has(view.id) ?? false;
            return (
              <DropdownMenuItem
                key={view.id}
                disabled={pendingViewId === view.id}
                onClick={() => void toggleView(view.id, view.name, isMember)}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span>{view.name}</span>
                  {isMember && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
