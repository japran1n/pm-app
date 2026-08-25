"use client";

// F263 (AS-510): the star toggle button shared by BOTH the sidebar's
// project row (components/nav/project-nav-list.tsx) and the project list
// page (app/(workspace)/w/[workspaceSlug]/projects/page.tsx) -- one
// implementation of the optimistic-toggle-with-rollback dance, not two
// parallel copies, per the clarified "existing Server Actions... same
// underlying action" answer. Mirrors components/task/watchers.tsx's
// handleToggle shape exactly: flip local state immediately, call the
// Server Action, roll back + toast.error on failure, toast.success on
// success.

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { favoriteProject, unfavoriteProject } from "@/lib/actions/favorites";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ProjectFavoriteButton({
  projectId,
  projectName,
  isFavorite,
  onChange,
  size = "icon",
  className,
}: {
  projectId: string;
  /** Used only for the toast/aria-label copy — no second data fetch. */
  projectName: string;
  isFavorite: boolean;
  /** Optional: lets a parent (e.g. ProjectNavList, which re-sorts the
   * pinned group) know the confirmed server result, so the pinned
   * ordering only moves once the write actually lands rather than while
   * still optimistic-pending. */
  onChange?: (nextIsFavorite: boolean) => void;
  size?: "icon" | "sm";
  className?: string;
}) {
  const [localIsFavorite, setLocalIsFavorite] = useState(isFavorite);
  const [isPending, startTransition] = useTransition();

  // Re-sync when the server-derived prop changes for a DIFFERENT reason
  // (e.g. the layout re-fetched after navigation) -- same "adjust state
  // during render on prop change" convention as Watchers' syncedTaskId.
  const [syncedProjectId, setSyncedProjectId] = useState(projectId);
  if (projectId !== syncedProjectId) {
    setSyncedProjectId(projectId);
    setLocalIsFavorite(isFavorite);
  }

  function handleToggle(event: React.MouseEvent) {
    // Prevent the button's click from also triggering an ancestor <Link>
    // navigation when this control is nested inside a project row link.
    event.preventDefault();
    event.stopPropagation();

    const previous = localIsFavorite;
    const next = !previous;

    setLocalIsFavorite(next);

    startTransition(async () => {
      const result = next
        ? await favoriteProject(projectId)
        : await unfavoriteProject(projectId);

      if (result.ok) {
        onChange?.(next);
        toast.success(
          next
            ? `${projectName} added to favourites.`
            : `${projectName} removed from favourites.`,
        );
      } else {
        // Rollback on failure, same convention as Watchers.handleToggle.
        setLocalIsFavorite(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={localIsFavorite}
      aria-label={
        localIsFavorite
          ? `Remove ${projectName} from favourites`
          : `Add ${projectName} to favourites`
      }
      title={
        localIsFavorite
          ? `Remove ${projectName} from favourites`
          : `Add ${projectName} to favourites`
      }
      className={cn(
        size === "icon" ? "size-7" : "h-7 px-1.5",
        "shrink-0 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Star
        aria-hidden="true"
        className={cn(
          "size-3.5",
          localIsFavorite && "fill-amber-400 text-amber-400",
        )}
      />
    </Button>
  );
}
