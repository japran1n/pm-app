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
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { addComment } from "@/lib/actions/comments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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
};

function authorLabel(
  userId: string,
  members: CommentListMember[],
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
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
}) {
  const [localComments, setLocalComments] = useState(comments);
  // Tracks which task's comments are currently loaded into local state, so
  // it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as TaskDetailSheet's
  // syncedTaskId / TagsEditor's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [draft, setDraft] = useState("");
  const [isSubmitting, startSubmitTransition] = useTransition();

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
                <span className="text-sm font-medium">
                  {authorLabel(comment.userId, members)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.createdAt), {
                    addSuffix: true,
                  })}
                </span>
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
          disabled={isSubmitting}
          placeholder="Add a comment…"
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
        />
        <Button type="submit" disabled={isSubmitting || !draft.trim()}>
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
