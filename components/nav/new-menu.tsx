"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckSquare, FolderPlus, Plus } from "lucide-react";

import { useMembership } from "@/components/auth/membership-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { canCreateProject, canWrite } from "@/lib/auth/permissions";
import {
  SHORTCUT_EVENTS,
  type NewTaskShortcutDetail,
} from "@/lib/hooks/use-shortcut";
import { cn } from "@/lib/utils";

// F009 (SB-033, SB-034): sidebar "+ New" menu. Reuses the existing create
// flows, no new forms:
//  - Task: on a project route it fires the same window event the `n`
//    shortcut uses, which opens that project's real NewTaskDialog. Tasks
//    belong to a project, so elsewhere it goes to the Projects page to pick
//    one (NewTaskDialog owns its open state and has no other entry point).
//  - Project: opens the real NewProjectDialog in place (F028), mounted as a
//    controlled sibling of the menu. The mobile Sheet is deliberately NOT
//    closed, since closing it would unmount this component and the dialog.
//  - No Request item (SB-060): requests are client-raised in the portal and
//    there is no staff-side create flow.
// Each entry is gated by the SAME predicate as its server action, so the UI
// can never offer something the server rejects (or hide something it allows):
//  - Task    -> canWrite (createTask). canWrite allows owner/admin/member AND
//    guest (guests create tasks in the projects they can see); it denies
//    viewer and client. So a guest sees "Task" but not "Project".
//  - Project -> canCreateProject (createProject + createProjectFromTemplate):
//    owner/admin/member only.
// If no entry remains the button is not rendered at all (SB-034).
export function NewMenu({
  workspaceSlug,
  workspaceId,
  isGuest,
  onNavigate,
}: {
  workspaceSlug: string;
  workspaceId: string;
  isGuest: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const membership = useMembership();
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  // Fail closed: no resolvable membership (provider absent, or the layout's
  // memberships query failed) means no create entries. The `isGuest` prop is
  // an extra deny on top of the shared predicate, never an allow.
  const canCreateProjectEntry =
    !isGuest && membership !== null && canCreateProject({ role: membership.role });
  const canCreateTaskEntry =
    membership !== null && canWrite({ role: membership.role });

  if (!canCreateProjectEntry && !canCreateTaskEntry) return null;

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  const newTask = () => {
    const projectId = pathname?.match(/\/projects\/([^/]+)/)?.[1];
    if (projectId) {
      // Handshake: NewTaskDialog is only mounted on the board and list
      // subroutes. If no listener acknowledges, fall through to the
      // project's board, which hosts the dialog, rather than no-opping.
      const detail: NewTaskShortcutDetail = { projectId, handled: false };
      window.dispatchEvent(
        new CustomEvent<NewTaskShortcutDetail>(SHORTCUT_EVENTS.newTask, {
          detail,
        }),
      );
      if (detail.handled) {
        onNavigate?.();
        return;
      }
      go(`/w/${workspaceSlug}/projects/${projectId}/board`);
      return;
    }
    go(`/w/${workspaceSlug}/projects`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md border bg-transparent px-2 text-sm font-medium text-foreground",
                "transition-colors duration-200 hover:border-[var(--border-control-hover)] hover:bg-muted/50",
                "motion-safe:active:scale-[0.97]",
              )}
            />
          }
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">New</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {canCreateTaskEntry && (
            <DropdownMenuItem onClick={newTask}>
              <CheckSquare className="size-4" aria-hidden="true" />
              Task
            </DropdownMenuItem>
          )}
          {canCreateProjectEntry && (
            <DropdownMenuItem onClick={() => setProjectDialogOpen(true)}>
              <FolderPlus className="size-4" aria-hidden="true" />
              Project
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canCreateProjectEntry && (
        <NewProjectDialog
          workspaceId={workspaceId}
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
        />
      )}
    </>
  );
}
