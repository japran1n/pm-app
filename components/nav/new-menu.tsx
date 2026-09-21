"use client";

import { usePathname, useRouter } from "next/navigation";
import { CheckSquare, FolderPlus, Inbox, Plus } from "lucide-react";

import { useMembership } from "@/components/auth/membership-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canWrite } from "@/lib/auth/permissions";
import { SHORTCUT_EVENTS, type NewTaskShortcutDetail } from "@/lib/hooks/use-shortcut";
import { cn } from "@/lib/utils";

// F009 (SB-033, SB-034): sidebar "+ New" menu. Reuses the existing create
// flows, no new forms:
//  - Task: on a project route it fires the same window event the `n`
//    shortcut uses, which opens that project's real NewTaskDialog. Tasks
//    belong to a project, so elsewhere it goes to the Projects page to pick
//    one (NewTaskDialog owns its open state and has no other entry point).
//  - Project: NewProjectDialog owns its own trigger/open state on the
//    Projects page, so this navigates there.
//  - Request: requests are raised by clients in the portal; the team-side
//    surface is the Client requests inbox, so this navigates there. Same
//    gate as that nav item (workspace has a client, owner/admin).
// Gating mirrors the flows: guests and viewers cannot create tasks or
// projects (createProject/canWrite server checks); if nothing remains the
// button is not rendered at all.
export function NewMenu({
  workspaceSlug,
  isGuest,
  canManageWorkspace,
  hasClient,
  onNavigate,
}: {
  workspaceSlug: string;
  isGuest: boolean;
  canManageWorkspace: boolean;
  hasClient: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const membership = useMembership();

  const canCreate = !isGuest && (membership ? canWrite({ role: membership.role }) : true);
  const canRequest = !isGuest && canManageWorkspace && hasClient;

  if (!canCreate && !canRequest) return null;

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  const newTask = () => {
    const projectId = pathname?.match(/\/projects\/([^/]+)/)?.[1];
    if (projectId) {
      onNavigate?.();
      window.dispatchEvent(
        new CustomEvent<NewTaskShortcutDetail>(SHORTCUT_EVENTS.newTask, {
          detail: { projectId },
        }),
      );
      return;
    }
    go(`/w/${workspaceSlug}/projects`);
  };

  return (
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
        {canCreate && (
          <DropdownMenuItem onClick={newTask}>
            <CheckSquare className="size-4" aria-hidden="true" />
            Task
          </DropdownMenuItem>
        )}
        {canCreate && (
          <DropdownMenuItem onClick={() => go(`/w/${workspaceSlug}/projects`)}>
            <FolderPlus className="size-4" aria-hidden="true" />
            Project
          </DropdownMenuItem>
        )}
        {canRequest && (
          <DropdownMenuItem onClick={() => go(`/w/${workspaceSlug}/requests`)}>
            <Inbox className="size-4" aria-hidden="true" />
            Request
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
