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

import { useEffect, useRef, useState, useTransition } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Loader2, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { JSONContent } from "@tiptap/react";

import {
  addComment,
  deleteComment,
  editComment,
  getMentionCandidates,
  restoreComment,
} from "@/lib/actions/comments";
// F261 (AS-508): reuses the exact same attachment upload action F258's
// drag-drop and F259's picker/progress paths use — no second upload
// implementation. See handlePastedImages below.
import { uploadAttachment } from "@/lib/actions/attachments";
import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import { showUndoToast } from "@/lib/toast/undo-toast";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import {
  appendAttachmentReference,
  docFromPlainText,
  extractPlainText,
  toPlainJson,
} from "@/lib/comments/rich-text";
import { Button } from "@/components/ui/button";
import { useMembership } from "@/components/auth/membership-provider";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UploadProgress,
  type UploadProgressJob,
} from "@/components/task/upload-progress";
import { useCommentsRealtime } from "@/components/task/use-comments-realtime";
import { reconcileComment } from "@/lib/tasks/reconcile-realtime-comment";
// F202 (AS-369): reactions from other viewers appear live, without a reload.
import { useReactionsRealtime } from "@/components/task/use-reactions-realtime";
// F201 (AS-366): reaction chips + emoji picker under each comment.
import {
  CommentReactions,
  applyReactionToggle,
  type CommentReactionSummary,
} from "@/components/task/comment-reactions";
// F122 (AS-214): each comment's author is now rendered via the shared
// avatar component instead of `authorLabel`'s plain text alone.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
// F174 (AS-312): comments support the same rich-text formatting as
// descriptions, reusing F169/F171's shared editor/renderer pair as-is —
// its own toolbar is already documented as "compact" (built from the
// existing shadcn Button primitives, no bespoke toolbar design), so no
// second, reduced-formatting-subset toolbar variant was built for
// comments; that would mean either a new prop on the shared, currently
// off-limits rich-text-editor.tsx (owned by a concurrent worker this
// session) or a parallel bespoke toolbar — both rejected per the
// clarified "simpler option, no new dependency, no second source of
// truth" answer. See this feature's handoff, Decisions made.
//
// Client-only by construction (components/editor/rich-text-editor.tsx's
// own doc comment): both components are lazy-loaded here via a plain
// dynamic `import()` inside an effect, rather than next/dynamic, so this
// file stays a single, simple client boundary and — importantly — so
// this component's existing SSR/no-DOM unit test
// (tests/unit/comment-list.test.ts, `renderToStaticMarkup`, environment:
// node, no window) keeps rendering the same plain-text content it always
// has (AS-096/AS-097 unaffected): before the effect ever runs, both the
// composer and the comment body fall back to plain-text rendering
// identical to this component's pre-F174 behaviour.
type RichTextEditorModule = {
  RichTextEditor: (props: {
    content?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    disabled?: boolean;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
    mentionSuggestions?: { id: string; label: string }[];
    /** F261 (AS-508): see rich-text-editor.tsx's own doc comment on this
     * prop — the comment composer is this codebase's only caller that
     * passes it. */
    onImagePaste?: (files: File[]) => void;
  }) => React.ReactElement | null;
  RichTextRenderer: (props: {
    content?: JSONContent | null;
    className?: string;
    "aria-label"?: string;
    mentionSuggestions?: { id: string; label: string }[];
  }) => React.ReactElement | null;
};

function useRichTextModule(): RichTextEditorModule | null {
  const [module, setModule] = useState<RichTextEditorModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/components/editor/rich-text-editor").then((imported) => {
      if (!cancelled) {
        setModule({
          RichTextEditor: imported.RichTextEditor,
          RichTextRenderer: imported.RichTextRenderer,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

export type TaskComment = {
  id: string;
  taskId: string;
  userId: string;
  text: string;
  /** F174 (AS-312): Tiptap JSONContent document for this comment. Falls
   * back to a single-paragraph wrap of `text` (docFromPlainText) for any
   * comment predating this feature or missing it for another reason —
   * every call site of this type constructs `bodyJson` the same way, so
   * rendering never needs its own separate fallback branch. */
  bodyJson?: JSONContent | null;
  createdAt: string;
  /** F197 (AS-362): timestamp of the comment's most recent edit, or
   * null/undefined if it has never been edited. Drives the "(edited)"
   * indicator next to the timestamp. */
  editedAt?: string | null;
  /** F201 (AS-366): this comment's reaction summary — emoji plus the user
   * ids of everyone reacting with it. Falls back to an empty array below
   * for any caller that hasn't been updated to fetch it yet, same
   * permissive-optional-prop convention as `bodyJson`/`editedAt`. */
  reactions?: CommentReactionSummary[];
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

// F198 (AS-363): exact edit time, used both for the hover `title` and the
// `aria-label` that carries the same information to screen readers — a
// hover-only `title` alone would fail AS-524 (screen readers don't reliably
// expose `title`), so the accessible name is set explicitly rather than
// relying on `title` to double as it.
function formatExactEditTime(iso: string): string {
  return format(new Date(iso), "PPpp");
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
  highlightCommentId,
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
  /** F304 (AS-374 follow-up): a notification's `?commentId=` deep-link,
   * threaded down from TaskDetailSheet. When present and matching a
   * comment actually rendered here, that comment is scrolled into view
   * and briefly highlighted once on mount/id-change — undefined/null (the
   * overwhelming majority of opens: a plain card click, or a `?taskId=`
   * -only deep-link) renders exactly as before. */
  highlightCommentId?: string | null;
}) {
  // F204 follow-up (AS-376, "not offered in the picker" half): the
  // @-mention suggestion source used to be simply every `members` entry
  // (all active workspace members, F203's original convention — see this
  // block's history). That's too wide: a workspace member with no access
  // to this task's (possibly private) project shouldn't be offered as a
  // mention candidate at all, even though the server-side check
  // (lib/comments/mentions.ts's sanitiseMentionsForVisibility, F204) would
  // already reject/strip a hand-crafted mention referencing them. This
  // fetches the narrowed, project-visibility-scoped id list via the
  // `getMentionCandidates` Server Action — which reuses
  // `resolveVisibleMentionIds`, the exact same predicate the server-side
  // strip uses, so the "who's visible" rule is defined in exactly one
  // place — and filters `members` down to just those ids for display data
  // (name/email/avatar), rather than fetching a second, duplicate member
  // record set.
  //
  // `null` (not yet resolved, or the fetch failed) intentionally means "no
  // suggestions offered yet" rather than falling back to the wider
  // all-members list — the safer default per this feature's "not offered"
  // requirement: a transient loading/error state should never widen who's
  // offered as a mention candidate.
  const [visibleMentionIds, setVisibleMentionIds] = useState<string[] | null>(
    null,
  );
  // Tracks which task's candidates `visibleMentionIds` currently reflects,
  // so a taskId change resets the picker to "not offered yet" during
  // render (same "adjust state during render on prop change" convention
  // as `syncedTaskId` below) rather than via a synchronous setState call
  // inside the effect body.
  const [syncedMentionTaskId, setSyncedMentionTaskId] = useState(taskId);
  if (taskId !== syncedMentionTaskId) {
    setSyncedMentionTaskId(taskId);
    setVisibleMentionIds(null);
  }

  useEffect(() => {
    let cancelled = false;
    getMentionCandidates(taskId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setVisibleMentionIds(result.data.userIds);
        } else {
          setVisibleMentionIds([]);
        }
      })
      // A REJECTED call (not an ok:false result) was previously unhandled:
      // the action can throw rather than return, and the rejection then
      // escaped as an unhandled promise rejection instead of degrading the
      // picker. Same outcome as the ok:false branch above — no mention
      // candidates offered — because a mention picker that cannot verify
      // visibility must offer nobody rather than everybody.
      .catch(() => {
        if (cancelled) return;
        setVisibleMentionIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const mentionSuggestions = members
    .filter(
      (member) =>
        visibleMentionIds !== null && visibleMentionIds.includes(member.userId),
    )
    .map((member) => ({
      id: member.userId,
      label: member.name || member.email || member.userId,
    }));

  // F308 (FU-12 item 3, AS-373): resolves a mention node's id to its live
  // display label for extractPlainText's projection — same member/label
  // source `mentionSuggestions` above already uses, just widened to the
  // full `members` list (not filtered to `visibleMentionIds`) so a
  // mention this composer instance can't currently re-suggest (e.g. the
  // mentioned member just lost project access) still resolves to a real
  // name rather than falling back to the raw id.
  const resolveMentionLabel = (userId: string): string | null => {
    const member = members.find((m) => m.userId === userId);
    return member ? member.name || member.email || member.userId : null;
  };

  const [localComments, setLocalComments] = useState(comments);
  // Tracks which task's comments are currently loaded into local state, so
  // it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as TaskDetailSheet's
  // syncedTaskId / TagsEditor's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  // F174 (AS-312): the composer's draft is a Tiptap JSONContent document,
  // not a plain string. `null` is the shared editor's own "empty" value
  // (RichTextEditorProps's doc comment).
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const richText = useRichTextModule();
  const [isSubmitting, startSubmitTransition] = useTransition();
  // F261 (AS-508): pasted-image upload progress rows for the add-comment
  // composer. A SEPARATE transition from isSubmitting/startSubmitTransition
  // above — an in-flight image upload must not disable the composer or the
  // Post button (the user can keep typing/posting while a screenshot
  // uploads), and per this feature's clarified failure-handling answer the
  // typed draft is never touched by a paste-upload failure.
  const [, startPasteUploadTransition] = useTransition();
  const [pasteUploadJobs, setPasteUploadJobs] = useState<UploadProgressJob[]>(
    [],
  );
  // Same "cancel = ignore the eventual result" convention as F259's
  // AttachmentList (no AbortController hook on the Server Action
  // transport) — see upload-progress.tsx's own header comment for the full
  // rationale.
  const cancelledPasteJobIdsRef = useRef(new Set<string>());
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [, startDeleteTransition] = useTransition();
  // F197 (AS-362): the comment currently in inline edit mode, and its
  // in-progress draft. Only one comment can be edited at a time — opening
  // a second edit implicitly discards an unsaved first one, same
  // single-draft convention as the add-comment composer above.
  const [editingCommentId, setEditingCommentId] = useState<string | null>(
    null,
  );
  const [editDraft, setEditDraft] = useState<JSONContent | null>(null);
  const [isSavingEdit, startEditTransition] = useTransition();

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

  // F202 (AS-369): reconcile every Realtime comment-reaction event into
  // local state via the same pure `applyReactionToggle` reducer F201's
  // own optimistic-update path already uses (handleReactionsChange
  // below) — a reaction added/removed by *another* viewer shows up here
  // without a manual refresh.
  //
  // F305 (AS-369 fix): self-events are NOT dropped anymore. This
  // viewer's own toggle from *this* tab is already applied optimistically
  // by handleReactionsChange, and folding the resulting Realtime event a
  // second time here is a harmless no-op (applyReactionToggle is
  // idempotent for a repeat add/remove of the same user+emoji) -- but a
  // SECOND browser tab for the same user has no local optimistic state to
  // no-op against, and previously never synced a reaction made in the
  // first tab until a manual reload because this handler unconditionally
  // dropped every event from the current user. Now that the subscription
  // is scoped per-task (task_id filter, see subscribeToReactionsRealtime)
  // there's no reason to special-case self-events at all.
  useReactionsRealtime(taskId, (event) => {
    setLocalComments((previous) =>
      previous.map((comment) =>
        comment.id === event.commentId
          ? {
              ...comment,
              reactions: applyReactionToggle(
                comment.reactions ?? [],
                event.emoji,
                event.eventType === "INSERT",
                event.userId,
              ),
            }
          : comment,
      ),
    );
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

  // F197 (AS-362, AS-364): unlike canDelete, deliberately author-only — no
  // admin/owner override. This mirrors editComment's own server-side rule
  // (lib/actions/comments.ts's doc comment has the full rationale); this
  // check only controls whether the edit affordance is shown, the server
  // action independently re-enforces it regardless.
  function canEdit(comment: TaskComment): boolean {
    if (!currentUserId || !canPost) return false;
    return comment.userId === currentUserId;
  }

  function startEditing(comment: TaskComment) {
    setEditingCommentId(comment.id);
    setEditDraft(comment.bodyJson ?? docFromPlainText(comment.text));
  }

  function cancelEditing() {
    setEditingCommentId(null);
    setEditDraft(null);
  }

  function saveEdit(commentId: string) {
    const plainText = extractPlainText(editDraft, resolveMentionLabel);
    if (!plainText) return;

    startEditTransition(async () => {
      // F339: same client-to-server boundary fix as the add-comment path
      // above — see lib/comments/rich-text.ts's `toPlainJson` doc comment.
      const result = await editComment(
        commentId,
        plainText,
        toPlainJson(editDraft),
      );
      if (result.ok) {
        setLocalComments((previous) =>
          previous.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  text: result.data.text,
                  bodyJson: result.data.bodyJson,
                  editedAt: result.data.editedAt,
                }
              : comment,
          ),
        );
        setEditingCommentId(null);
        setEditDraft(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  // F201 (AS-366): mirrors saveEdit's convention of updating just the
  // affected comment's fields in local state after a successful Server
  // Action call — no re-fetch of the whole comments list needed.
  function handleReactionsChange(
    commentId: string,
    reactions: CommentReactionSummary[],
  ) {
    setLocalComments((previous) =>
      previous.map((comment) =>
        comment.id === commentId ? { ...comment, reactions } : comment,
      ),
    );
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
        // F190 (AS-345): Undo restores this exact comment without
        // visiting trash. restoreComment's return shape already matches
        // TaskComment exactly, so it's appended straight back into local
        // state the same way addComment's own success path does above —
        // no second fetch, no second source of truth for the comment's
        // fields.
        showUndoToast({
          message: "Comment deleted.",
          onUndo: async () => {
            const restoreResult = await restoreComment(commentId);
            if (restoreResult.ok) {
              setLocalComments((previous) =>
                previous.some((comment) => comment.id === commentId)
                  ? previous
                  : [...previous, restoreResult.data],
              );
              toast.success("Comment restored.");
            } else {
              toast.error(restoreResult.error);
            }
          },
        });
      } else {
        toast.error(result.error);
      }
      setDeletingCommentId(null);
    });
  }

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalComments(comments);
    setDraft(null);
    setEditingCommentId(null);
    setEditDraft(null);
  }

  const orderedComments = sortedOldestFirst(localComments);
  const draftPlainText = extractPlainText(draft, resolveMentionLabel);

  // F304 (AS-374 follow-up): scroll to and briefly highlight the comment
  // requested via the notification deep-link, once it's actually
  // rendered in `orderedComments`. Re-runs on `highlightCommentId`
  // changing (a new deep-link open of the same sheet instance) and on
  // `orderedComments` changing (the comment may not exist in the DOM yet
  // on the very first render if `comments` arrives after this component
  // mounts, e.g. TaskDetailSheet's loading state briefly rendering an
  // empty list first). `document.getElementById` (not a ref map) is the
  // simplest option here — no second parallel array of refs keyed by
  // comment id to keep in sync with `orderedComments`.
  useEffect(() => {
    if (!highlightCommentId) return;
    if (!orderedComments.some((c) => c.id === highlightCommentId)) return;
    const el = document.getElementById(`comment-${highlightCommentId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("comment-highlighted");
    const timeout = setTimeout(() => {
      el.classList.remove("comment-highlighted");
    }, 2000);
    return () => clearTimeout(timeout);
  }, [highlightCommentId, orderedComments]);

  // F261 (AS-508): an image pasted into the add-comment composer uploads
  // as a real task attachment through the SAME `uploadAttachment` Server
  // Action F258's drag-drop and F259's file-picker paths already use — no
  // parallel upload implementation. On success, a plain-text reference
  // (not an inline `<img>`, see appendAttachmentReference's doc comment
  // for why) is appended to the draft; the image itself shows up in the
  // task's existing attachment list, same as any other dropped/picked
  // file. On failure, the draft is NEVER touched — only the toast + the
  // upload-progress row reflect the failure, satisfying "the typed
  // comment text must remain intact".
  function handlePastedImages(files: File[]) {
    if (!canPost) return;
    for (const file of files) {
      const jobId = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const validation = validateAttachmentFile(file);
      if (!validation.ok) {
        setPasteUploadJobs((previous) => [
          ...previous,
          {
            id: jobId,
            fileName: file.name,
            fileSize: file.size,
            status: "rejected",
            reason: validation.reason,
          },
        ]);
        continue;
      }

      setPasteUploadJobs((previous) => [
        ...previous,
        {
          id: jobId,
          fileName: file.name,
          fileSize: file.size,
          status: "uploading",
        },
      ]);

      startPasteUploadTransition(async () => {
        const formData = new FormData();
        formData.set("taskId", taskId);
        formData.set("file", file);
        const result = await uploadAttachment(formData);

        if (cancelledPasteJobIdsRef.current.has(jobId)) {
          cancelledPasteJobIdsRef.current.delete(jobId);
          return;
        }

        if (result.ok) {
          setPasteUploadJobs((previous) =>
            previous.map((job) =>
              job.id === jobId ? { ...job, status: "success" } : job,
            ),
          );
          setDraft((previousDraft) =>
            appendAttachmentReference(previousDraft, result.data.fileName),
          );
        } else {
          setPasteUploadJobs((previous) =>
            previous.map((job) =>
              job.id === jobId
                ? { ...job, status: "error", reason: result.error }
                : job,
            ),
          );
          toast.error(result.error);
        }
      });
    }
  }

  function cancelPasteUpload(jobId: string) {
    cancelledPasteJobIdsRef.current.add(jobId);
    setPasteUploadJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  function dismissPasteUpload(jobId: string) {
    setPasteUploadJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  // C7: whether the next comment goes to the client as well as the team.
  // Defaults to off, matching the server's own default — see addComment's
  // `internal` parameter for why the safe direction is team-only.
  const [shareWithClient, setShareWithClient] = useState(false);
  const workspaceHasClient = useMembership()?.hasClient ?? false;

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!draftPlainText) return;

    startSubmitTransition(async () => {
      // F174 (AS-312): posts both the plain-text projection (pre-flight
      // non-empty check, same shape addCommentSchema has always
      // validated) and the real Tiptap document — see
      // lib/actions/comments.ts's addComment doc comment for why both are
      // sent and how the server treats them.
      //
      // F339 (M18 scrutiny BLOCKER-4): `draft` is round-tripped through
      // `toPlainJson` immediately before crossing the Server Action
      // boundary — see that helper's doc comment
      // (lib/comments/rich-text.ts) for the live-reproduced root cause
      // (a shared/interned ProseMirror `attrs` object reference being
      // encoded as an unreadable React "temporary reference" instead of
      // plain data whenever the document contains a real `mention` node).
      const result = await addComment(
        taskId,
        draftPlainText,
        toPlainJson(draft),
        // C7: internal is the inverse of the "send to client" choice, and
        // that choice resets after every post. Someone answering the
        // client once should not silently keep broadcasting the rest of
        // the thread to them.
        !shareWithClient,
      );
      if (result.ok) {
        setLocalComments((previous) => [...previous, result.data]);
        setDraft(null);
        setShareWithClient(false);
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
            <li
              key={comment.id}
              id={`comment-${comment.id}`}
              className="flex flex-col gap-0.5 rounded-md transition-colors duration-500 [&.comment-highlighted]:bg-accent/60"
            >
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
                {comment.editedAt && (
                  // F198 (AS-363): a visible "(edited)" marker so other
                  // viewers know the content changed since it was posted.
                  // `title` surfaces the exact edit time on hover for
                  // sighted mouse users; `aria-label` independently carries
                  // that same exact time as this span's accessible name, so
                  // screen readers get it regardless of whether they expose
                  // `title` (AS-524 — hover-only information is not
                  // sufficient). Live updates for other viewers already
                  // looking at the task come from `reconcileComment`
                  // (lib/tasks/reconcile-realtime-comment.ts) replacing the
                  // comment's `editedAt` on the `comment_edited` broadcast
                  // F197 added — no extra wiring needed here, this
                  // component just renders whatever `editedAt` holds.
                  <span
                    className="text-xs text-muted-foreground"
                    title={`Edited ${formatExactEditTime(comment.editedAt)}`}
                    aria-label={`Edited ${formatExactEditTime(comment.editedAt)}`}
                  >
                    (edited)
                  </span>
                )}
                {canEdit(comment) && editingCommentId !== comment.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label="Edit comment"
                    onClick={() => startEditing(comment)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
                {canDelete(comment) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={
                      canEdit(comment) && editingCommentId !== comment.id
                        ? "size-6"
                        : "ml-auto size-6"
                    }
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
              {editingCommentId === comment.id ? (
                // F197: inline edit mode, reusing the shared RichTextEditor
                // exactly as the add-comment composer does above. Keyboard
                // conventions match this codebase's established editor
                // shortcuts (F169/F172): Escape cancels without saving,
                // Cmd/Ctrl+Enter saves — caught here on the wrapping div
                // since keydown bubbles up from the editor's contentEditable
                // root, so no change to the shared, off-limits
                // rich-text-editor.tsx component is needed.
                <div
                  className="flex flex-col gap-2"
                  onKeyDown={(keyDownEvent) => {
                    if (keyDownEvent.key === "Escape") {
                      keyDownEvent.preventDefault();
                      cancelEditing();
                    } else if (
                      keyDownEvent.key === "Enter" &&
                      (keyDownEvent.metaKey || keyDownEvent.ctrlKey)
                    ) {
                      keyDownEvent.preventDefault();
                      saveEdit(comment.id);
                    }
                  }}
                >
                  {richText ? (
                    <richText.RichTextEditor
                      content={editDraft}
                      onChange={setEditDraft}
                      disabled={isSavingEdit}
                      aria-label="Edit comment"
                      mentionSuggestions={mentionSuggestions}
                    />
                  ) : (
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={extractPlainText(editDraft, resolveMentionLabel)}
                      disabled={isSavingEdit}
                      onChange={(changeEvent) =>
                        setEditDraft(
                          docFromPlainText(changeEvent.target.value),
                        )
                      }
                    />
                  )}
                  <div className="flex gap-2 self-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSavingEdit}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        isSavingEdit || !extractPlainText(editDraft, resolveMentionLabel)
                      }
                      onClick={() => saveEdit(comment.id)}
                    >
                      {isSavingEdit ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                </div>
              ) : richText ? (
                <richText.RichTextRenderer
                  content={comment.bodyJson ?? docFromPlainText(comment.text)}
                  aria-label={`Comment by ${authorLabel(comment.userId, members)}`}
                  mentionSuggestions={mentionSuggestions}
                />
              ) : (
                // F174: pre-hydration fallback, identical to this
                // component's pre-F174 rendering — keeps
                // tests/unit/comment-list.test.ts's AS-096/AS-097
                // assertions (which render via renderToStaticMarkup, no
                // DOM/effects) passing unchanged.
                <p className="whitespace-pre-wrap text-sm">{comment.text}</p>
              )}
              {editingCommentId !== comment.id && (
                <CommentReactions
                  commentId={comment.id}
                  reactions={comment.reactions ?? []}
                  members={members}
                  currentUserId={currentUserId}
                  canReact={canPost}
                  onChange={(next) => handleReactionsChange(comment.id, next)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2"
        aria-label="Add a comment"
      >
        <Label htmlFor={`comment-draft-${taskId}`} className="sr-only">
          Add a comment
        </Label>
        <UploadProgress
          jobs={pasteUploadJobs}
          onCancel={cancelPasteUpload}
          onDismiss={dismissPasteUpload}
        />
        {richText ? (
          <richText.RichTextEditor
            content={draft}
            onChange={setDraft}
            disabled={isSubmitting || !canPost}
            placeholder={canPost ? "Add a comment…" : "Viewers can't comment"}
            aria-label="Add a comment"
            mentionSuggestions={mentionSuggestions}
            onImagePaste={handlePastedImages}
          />
        ) : (
          // F174: pre-hydration fallback — a plain input bound to the
          // same JSONContent draft state via docFromPlainText, so typing
          // before the editor has loaded is not lost once it does.
          <input
            id={`comment-draft-${taskId}`}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
            value={draftPlainText}
            disabled={isSubmitting || !canPost}
            placeholder={canPost ? "Add a comment…" : "Viewers can't comment"}
            title={canPost ? undefined : "Viewers can't comment"}
            onChange={(changeEvent) =>
              setDraft(docFromPlainText(changeEvent.target.value))
            }
          />
        )}
        {/* C7: only shown where there is a client to send to, and only
            to someone who may post at all. Its label states the effect on
            the reader rather than the column name — "internal" is our
            word, "the client will see this" is what the writer needs to
            know before hitting send. */}
        {workspaceHasClient && canPost && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={shareWithClient}
              onChange={(event) => setShareWithClient(event.target.checked)}
              disabled={isSubmitting}
              className="size-4 rounded border-input"
            />
            Also send to the client
          </label>
        )}
        <Button
          type="submit"
          className="self-end"
          disabled={isSubmitting || !draftPlainText || !canPost}
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
