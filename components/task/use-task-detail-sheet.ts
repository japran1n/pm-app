"use client";

// BUGFIX (TaskDetailSheet was fully built but never rendered anywhere):
// shared "which task is open, and its fetched-on-demand detail" state,
// factored out so both the Board view (components/board/board.tsx) and
// the List view (components/task/task-list-table.tsx) can open the same
// <TaskDetailSheet> the same way, instead of duplicating this fetch/open/
// close/retry logic in two places.
//
// TaskDetailSheet's props interface (loading/error/onRetry) already
// anticipated exactly this shape (see that component's own doc comment:
// "a future caller can drive [loading/error]") — this hook is that
// caller's fetch-on-open plumbing, calling lib/actions/tasks.ts's
// getTaskDetail Server Action (which returns the task's full detail,
// comments, attachments, and the viewer's own id/role in one round trip)
// the moment a task is opened, rather than requiring the board/list's
// initial summary-only queries (getProjectBoardTasks/getProjectListTasks)
// to carry every TaskDetailSheet field up front.

// F247 (AS-475, AS-476, AS-478): this hook is the SINGLE place that
// mounts the task detail sheet on top of the board/list's own URL, so
// opening/closing here stays on the one `?taskId=` deep-link contract
// F246 established (see that feature's handoff — it deliberately did not
// fork a second, route-based contract). Opening a task from a click
// pushes `?taskId={id}` onto the CURRENT page's URL (same pathname, every
// other existing search param — filters, groupBy, view, etc. — preserved
// verbatim) via `router.push(..., { scroll: false })`: a soft/client-side
// navigation, not a full reload, and `scroll: false` keeps the caller's
// current scroll position instead of Next's default scroll-to-top.
// Closing prefers `router.back()` (so the browser's own history entry —
// with its own preserved scroll position and filters — is what the user
// lands on) and only falls back to stripping `?taskId=` in place
// (`router.replace`) when the sheet was opened some other way than this
// hook's own `push` (e.g. a hard refresh landed directly on a `?taskId=`
// URL with no prior in-app history to go back to). Because opening always
// pushes a new history entry, the browser's native Back button closes the
// sheet by construction (AS-478) — no separate popstate listener needed;
// the caller's own `?taskId=` read-on-mount effect (see board.tsx) reacts
// to the search params changing back to "no taskId" and calls
// `closeFromUrl` to sync local state without re-triggering navigation.
import { useCallback, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskDetailSheetTask } from "@/components/task/task-detail-sheet";
import type { TaskComment } from "@/components/task/comment-list";
import type { TaskAttachment } from "@/components/task/attachment-list";
import type { WorkspaceRole } from "@/lib/auth/permissions";

type TaskDetailState = {
  task: TaskDetailSheetTask;
  comments: TaskComment[];
  attachments: TaskAttachment[];
  currentUserId: string;
  // F128 (AS-216): widened to the full `WorkspaceRole` (adds "viewer" |
  // "guest") so the sheet can disable write controls for a read-only
  // caller — see comment-list.tsx/attachment-list.tsx/time-tracking.tsx.
  currentUserRole: WorkspaceRole;
};

export function useTaskDetailSheet() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TaskDetailState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // True only for a taskId this hook itself pushed onto the URL (a click
  // inside the app) — false for a task that was already the URL's
  // `?taskId=` when this hook first opened it (a direct load/refresh),
  // which has no "back" entry of its own to return to.
  const pushedTaskIdRef = useRef(false);

  const fetchDetail = useCallback(async (taskId: string) => {
    setLoading(true);
    setError(null);
    const result = await getTaskDetail(taskId);
    if (result.ok) {
      setDetail(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  const buildUrl = useCallback(
    (taskId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (taskId) {
        params.set("taskId", taskId);
      } else {
        params.delete("taskId");
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const openTask = useCallback(
    (taskId: string, options?: { fromUrl?: boolean }) => {
      setOpenTaskId(taskId);
      setOpen(true);
      setDetail(null);
      setError(null);
      void fetchDetail(taskId);

      // `fromUrl` is set by the caller's own "?taskId= present on
      // mount/back-forward" effect (see board.tsx) — the URL already
      // reflects this taskId, so pushing again would create a duplicate,
      // useless history entry the user would have to hit Back twice to
      // get past.
      if (!options?.fromUrl && searchParams.get("taskId") !== taskId) {
        pushedTaskIdRef.current = true;
        router.push(buildUrl(taskId), { scroll: false });
      }
    },
    [fetchDetail, router, buildUrl, searchParams],
  );

  const clearLocalState = useCallback(() => {
    setOpen(false);
    // Cleared on close (not just hidden) so a later re-open of the same
    // task starts from a clean loading state rather than briefly
    // flashing the previous task's now-stale detail.
    setOpenTaskId(null);
    setDetail(null);
    setError(null);
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setOpen(true);
        return;
      }
      clearLocalState();
      if (searchParams.get("taskId")) {
        if (
          pushedTaskIdRef.current &&
          typeof window !== "undefined" &&
          window.history.length > 1
        ) {
          // Prefer native back navigation: it lands the user on the exact
          // prior URL (same filters, same scroll restoration Next/the
          // browser already handle for a real history entry) rather than
          // a synthetic "strip the param" URL this hook would otherwise
          // have to guess.
          router.back();
        } else {
          router.replace(buildUrl(null), { scroll: false });
        }
      }
      pushedTaskIdRef.current = false;
    },
    [router, buildUrl, searchParams, clearLocalState],
  );

  // Called by the caller's `?taskId=` sync effect when the URL's taskId
  // has already disappeared (e.g. the browser Back button fired and the
  // URL changed before React re-rendered) — clears local state only, no
  // further navigation, so it can't fight the navigation that already
  // happened.
  const closeFromUrl = useCallback(() => {
    clearLocalState();
    pushedTaskIdRef.current = false;
  }, [clearLocalState]);

  const retry = useCallback(() => {
    if (openTaskId) void fetchDetail(openTaskId);
  }, [openTaskId, fetchDetail]);

  return {
    open,
    openTaskId,
    openTask,
    onOpenChange,
    closeFromUrl,
    loading,
    error,
    task: detail?.task ?? null,
    comments: detail?.comments ?? [],
    attachments: detail?.attachments ?? [],
    currentUserId: detail?.currentUserId,
    currentUserRole: detail?.currentUserRole,
    retry,
  };
}
