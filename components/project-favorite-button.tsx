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

  // Re-sync when the server-derived prop changes -- either because the
  // caller now points at a DIFFERENT project (`projectId` changed) or
  // because THIS SAME project's confirmed favourite status changed
  // upstream (`isFavorite` changed): a server refresh (e.g.
  // revalidatePath from lib/actions/favorites.ts firing after this same
  // action settles server-side, or a sibling tab/session toggling the
  // same project) that disagrees with this button's local optimistic
  // state must win rather than be silently discarded, per F046 (M3
  // scrutiny attempt 2, FU-19). Tracking both fields in the sync key
  // (rather than `projectId` alone, the pre-fix behaviour) means a prop
  // update that only changes `isFavorite` is no longer ignored just
  // because `projectId` stayed the same. Same "adjust state during
  // render on prop change" convention as Watchers' syncedTaskId.
  const [syncedProjectId, setSyncedProjectId] = useState(projectId);
  const [syncedIsFavorite, setSyncedIsFavorite] = useState(isFavorite);
  if (projectId !== syncedProjectId || isFavorite !== syncedIsFavorite) {
    setSyncedProjectId(projectId);
    setSyncedIsFavorite(isFavorite);
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
