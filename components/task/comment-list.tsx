"use client";

// F060: task comment list + add-comment form (AS-096, AS-097).
//
// Pattern: this deviates from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") for the same reason components/task/tags-editor.tsx
// (F041) does — this component is composed *inside*
// components/task/task-detail-sheet.tsx (F039), which is already a Client
// Component (its own doc comment explains why: the caller fetches the task
// + members and passes them down as props, and the Sheet owns the
// interactive editing surface). Splitting comment-list into a Server
// Component wrapper here would require either a second network round trip
// from a Client parent or prop-drilling a fetched-comments array anyway —
// so, matching TaskDetailSheet/TagsEditor's existing convention, the
// caller (a future Server Component page) fetches the initial comments
// list and passes it down as `comments`; this component owns rendering
// plus the add-comment form's interactive state, and appends newly-added
// comments to local state (optimistic-append, matching TagsEditor's
// optimistic-update-with-revert convention) rather than re-fetching.
//
// Author display: comment authors are always active members of the task's
// workspace (enforced by lib/actions/comments.ts's requireActiveMembership
// check and the comments_insert_active_members RLS policy), so author
// name/email is resolved by matching `comment.userId` against the
// `members` list TaskDetailSheet already receives and passes through here
// — this avoids the N-per-comment Auth Admin API calls that
// lib/queries/members.ts's own doc comment flags as a known limitation
// for member lists; comments reuse the members list that's already loaded
// once per Sheet open instead of repeating that cost per comment.
//
// AS-096: comments are rendered oldest-first. The `comments` prop is
// expected pre-sorted by the caller's query (ascending created_at, per
// lib/queries/comments.ts's getTaskComments), and this component also
// defensively re-sorts before rendering so the ordering guarantee holds
// even if a future caller passes them unsorted — the assertion is about
// what's on screen, not about trusting the caller.
//
// AS-097: each comment shows its author (name, falling back to email, then
// user id, same fallback order as TaskDetailSheet's memberLabel) and a
// relative timestamp via date-fns's formatDistanceToNow (already in
// tech-decisions.md's libraries list for exactly this use).

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addComment, deleteComment } from "@/lib/actions/comments";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommentsRealtime } from "@/components/task/use-comments-realtime";
import { reconcileComment } from "@/lib/tasks/reconcile-realtime-comment";
// F122 (AS-214): each comment's author is now rendered via the shared
// avatar component instead of `authorLabel`'s plain text alone.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";

export type TaskComment = {
  id: string;
  taskId: string;
  userId: string;
  text: string;
  createdAt: string;
};

export type CommentListMember = {
  userId: string;
  email: string | null;
  name: string | null;
  /** F122 (AS-214): optional — a caller that hasn't been updated to fetch
   * it yet just gets the initials-avatar fallback. */
  avatarUrl?: string | null;
};

function authorLabel(
  userId: string,
  members: CommentListMember[],
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
}

function authorOf(
  userId: string,
  members: CommentListMember[],
): UserAvatarPerson {
  const member = members.find((m) => m.userId === userId);
  return {
    id: userId,
    email: member?.email ?? null,
    name: member?.name ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

function sortedOldestFirst(comments: TaskComment[]): TaskComment[] {
  return [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function CommentList({
  taskId,
  comments,
  members,
  loading = false,
  error = null,
  onRetry,
  currentUserId,
  currentUserRole,
}: {
  taskId: string;
  /** Initial comments for this task, ideally already oldest-first. */
  comments: TaskComment[];
  /** Workspace members, used to resolve each comment's author display. */
  members: CommentListMember[];
  /** Drives the loading skeleton when a future caller is still fetching. */
  loading?: boolean;
  /** Drives the inline error state when a future caller's fetch failed. */
  error?: string | null;
  onRetry?: () => void;
  /** F061 (AS-098, AS-099, AS-100): the viewer's own user id. A comment's
   * delete button is only rendered when this equals the comment's author,
   * or when `currentUserRole` is "owner"/"admin". Undefined hides delete
   * everywhere — the server (`deleteComment`) independently re-checks
   * authorization regardless, so this prop only controls UI affordance,
   * never the actual guarantee (AS-099's "unavailable in the UI *and*
   * rejected server-side" — hiding the button is the UX half; the Server
   * Action call is the enforcement half). */
  currentUserId?: string;
  /** F061 (AS-100): the viewer's active role in this task's workspace.
   * F128 (AS-216): widened to the full `WorkspaceRole` (includes "viewer"
   * | "guest") so the add-comment form can be disabled for a read-only
   * caller — the server (`addComment`) independently rejects the call
   * regardless, this only controls UI affordance. */
  currentUserRole?: WorkspaceRole;
}) {
  const [localComments, setLocalComments] = useState(comments);
  // Tracks which task's comments are currently loaded into local state, so
  // it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as TaskDetailSheet's
  // syncedTaskId / TagsEditor's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [draft, setDraft] = useState("");
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [, startDeleteTransition] = useTransition();

  // F062 (AS-101, AS-102): reconcile every Realtime postgres_changes event
  // for this task's comments into local state via the pure
  // `reconcileComment` reducer. This is what makes a soft-delete performed
  // by *another* viewer (author, admin, or owner) disappear from this
  // viewer's already-open task view without a manual refresh — the local
  // `filter` in handleDelete above only covers the case where *this*
  // viewer performed the delete themselves.
  useCommentsRealtime(taskId, (event) => {
    setLocalComments((previous) => reconcileComment(previous, event));
  });

  const isAdminOrOwner =
    currentUserRole === "owner" || currentUserRole === "admin";
  // F128 (AS-216): viewers/guests never see a usable add-comment form.
  // Undefined currentUserRole (caller hasn't wired it through yet) is
  // treated as writable, same permissive default the rest of this file
  // already applies to unset optional props.
  const canPost = currentUserRole ? canWrite({ role: currentUserRole }) : true;

  function canDelete(comment: TaskComment): boolean {
    if (!currentUserId) return false;
    return comment.userId === currentUserId || isAdminOrOwner;
  }

  function handleDelete(commentId: string) {
    setDeletingCommentId(commentId);
    startDeleteTransition(async () => {
      const result = await deleteComment(commentId);
      if (result.ok) {
        // AS-101/AS-102: remove locally so it disappears immediately for
        // this viewer; the server soft-delete plus revalidatePath handles
        // it disappearing for other viewers/on reload.
        setLocalComments((previous) =>
          previous.filter((comment) => comment.id !== commentId),
        );
      } else {
        toast.error(result.error);
      }
      setDeletingCommentId(null);
    });
  }

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalComments(comments);
    setDraft("");
  }

  const orderedComments = sortedOldestFirst(localComments);

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;

    startSubmitTransition(async () => {
      const result = await addComment(taskId, trimmed);
      if (result.ok) {
        setLocalComments((previous) => [...previous, result.data]);
        setDraft("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Comments</Label>

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : error ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">{error}</p>
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      ) : orderedComments.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="size-4" aria-hidden="true" />
          No comments yet. Be the first to add one.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderedComments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <UserAvatar
                  person={authorOf(comment.userId, members)}
                  size="sm"
                />
                <span className="text-sm font-medium">
                  {authorLabel(comment.userId, members)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                {canDelete(comment) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6"
                    disabled={deletingCommentId === comment.id}
                    aria-label="Delete comment"
                    onClick={() => handleDelete(comment.id)}
                  >
                    {deletingCommentId === comment.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    )}
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{comment.text}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex gap-2"
        aria-label="Add a comment"
      >
        <Label htmlFor={`comment-draft-${taskId}`} className="sr-only">
          Add a comment
        </Label>
        <Input
          id={`comment-draft-${taskId}`}
          value={draft}
          disabled={isSubmitting || !canPost}
          placeholder={canPost ? "Add a comment…" : "Viewers can't comment"}
          title={canPost ? undefined : "Viewers can't comment"}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
        />
        <Button
          type="submit"
          disabled={isSubmitting || !draft.trim() || !canPost}
          title={canPost ? undefined : "Viewers can't comment"}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            "Post"
          )}
        </Button>
      </form>
    </div>
  );
}
