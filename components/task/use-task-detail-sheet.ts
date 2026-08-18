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

import { useCallback, useState } from "react";

import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskDetailSheetTask } from "@/components/task/task-detail-sheet";
import type { TaskComment } from "@/components/task/comment-list";
import type { TaskAttachment } from "@/components/task/attachment-list";

type TaskDetailState = {
  task: TaskDetailSheetTask;
  comments: TaskComment[];
  attachments: TaskAttachment[];
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member";
};

export function useTaskDetailSheet() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TaskDetailState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const openTask = useCallback(
    (taskId: string) => {
      setOpenTaskId(taskId);
      setOpen(true);
      setDetail(null);
      setError(null);
      void fetchDetail(taskId);
    },
    [fetchDetail],
  );

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      // Cleared on close (not just hidden) so a later re-open of the same
      // task starts from a clean loading state rather than briefly
      // flashing the previous task's now-stale detail.
      setOpenTaskId(null);
      setDetail(null);
      setError(null);
    }
  }, []);

  const retry = useCallback(() => {
    if (openTaskId) void fetchDetail(openTaskId);
  }, [openTaskId, fetchDetail]);

  return {
    open,
    openTaskId,
    openTask,
    onOpenChange,
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
