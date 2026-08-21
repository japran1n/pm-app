"use client";

// F066: task attachment list + upload control (AS-109, AS-115).
//
// Pattern: same deviation from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") that components/task/comment-list.tsx (F060) and
// components/task/tags-editor.tsx (F041) document — this component is
// composed *inside* components/task/task-detail-sheet.tsx (F039), which is
// already a Client Component. Splitting this into a Server Component
// wrapper would require either a second network round trip from a Client
// parent or prop-drilling a fetched-attachments array anyway, so matching
// the existing convention: the caller (a future Server Component page)
// fetches the task's initial attachments and passes them down as
// `attachments`; this component owns rendering plus the upload form's
// interactive state, and appends newly-uploaded attachments to local state
// (optimistic-append, matching CommentList's convention) rather than
// re-fetching or reloading the page.
//
// AS-109: each attachment shows its file name and uploader. Uploader
// display resolves `attachment.uploadedBy` against the `members` list
// TaskDetailSheet already receives and passes through here (same
// author-resolution convention as CommentList's `authorLabel`), avoiding
// per-attachment Auth Admin API calls.
//
// AS-115: after a successful upload, `uploadAttachment`'s return value
// (which already includes a fresh signed URL — see lib/actions/
// attachments.ts) is appended directly to local state, so the new
// attachment appears in the list immediately without a page reload.
//
// Signed URLs are time-limited (SIGNED_URL_TTL_SECONDS in
// lib/actions/attachments.ts), so this component never caches one for
// long: the URL returned by upload is used as-is for the immediately-newly
// -added attachment (freshly minted, safe to use right away), but every
// attachment's "Open" link otherwise calls `getAttachmentSignedUrl` on
// click to mint a fresh one on demand rather than trusting a possibly
// stale cached URL — satisfying "generate on demand, don't cache a stale
// one."

import { useEffect, useState, useTransition } from "react";
import { Loader2, Paperclip, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAttachment,
  getAttachmentSignedUrl,
  uploadAttachment,
} from "@/lib/actions/attachments";
import { appendAttachment } from "@/lib/tasks/append-attachment";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export type TaskAttachment = {
  id: string;
  taskId: string;
  fileName: string;
  fileUrl: string;
  uploadedBy: string;
  createdAt: string;
  /** Follow-up (2026-08-21, user-reported): the file's MIME type, persisted
   * at upload time (attachments.mime_type). Null for attachments uploaded
   * before this column existed — treated identically to a non-image type:
   * no thumbnail, plain filename-link rendering. */
  mimeType: string | null;
};

export type AttachmentListMember = {
  userId: string;
  email: string | null;
  name: string | null;
};

function uploaderLabel(
  userId: string,
  members: AttachmentListMember[],
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
}

// Follow-up (2026-08-21, user-reported): inline thumbnail preview for
// image/* attachments, so a screenshot doesn't require a click-through to
// view. Mints its own signed URL on mount (proactively, not on click) via
// the same getAttachmentSignedUrl mechanism the "Open" click already uses.
//
// Signed-URL TTL tradeoff (SIGNED_URL_TTL_SECONDS = 1 hour, see
// lib/actions/attachments.ts): the thumbnail's URL is minted once on mount
// and not proactively refreshed. If the task detail sheet is left open
// longer than an hour, the thumbnail's <img> may start 404ing against an
// expired signed URL. This is an accepted tradeoff (not silently broken —
// re-opening the task detail sheet re-mounts this component and mints a
// fresh URL) rather than adding a refresh-interval timer for a case (a
// single sheet left open >1hr) this codebase's other attachment UI doesn't
// otherwise guard against either.
function AttachmentThumbnail({
  attachmentId,
  fileName,
  onOpen,
}: {
  attachmentId: string;
  fileName: string;
  onOpen: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAttachmentSignedUrl(attachmentId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSignedUrl(result.signedUrl);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (status === "loading") {
    return <Skeleton className="h-20 w-20 rounded" />;
  }

  // AS: on failure to mint a signed URL, render nothing here — the
  // filename link in the parent row is still a working fallback, never a
  // broken-image icon.
  if (status === "error" || !signedUrl) {
    return null;
  }

  return (
    <button
      type="button"
      className="block h-20 w-20 overflow-hidden rounded border"
      onClick={onOpen}
      aria-label={`Open ${fileName}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed
          Storage URLs are short-lived and not a static asset next/image can
          usefully optimize; a plain <img> matches this component's existing
          convention of not routing attachment access through next/image. */}
      <img
        src={signedUrl}
        alt={fileName}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

export function AttachmentList({
  taskId,
  attachments,
  members,
  loading = false,
  error = null,
  onRetry,
  currentUserId,
  currentUserRole,
}: {
  taskId: string;
  /** Initial attachments for this task. */
  attachments: TaskAttachment[];
  /** Workspace members, used to resolve each attachment's uploader display. */
  members: AttachmentListMember[];
  /** Drives the loading skeleton when a future caller is still fetching. */
  loading?: boolean;
  /** Drives the inline error state when a future caller's fetch failed. */
  error?: string | null;
  onRetry?: () => void;
  /** F067 (AS-110, AS-111): the viewer's own user id. An attachment's
   * delete button is only rendered when this equals the attachment's
   * uploader, or when `currentUserRole` is "owner"/"admin". Undefined
   * hides delete everywhere — `deleteAttachment` independently re-checks
   * authorization regardless, so this prop only controls UI affordance,
   * never the actual guarantee (same convention as CommentList's
   * `currentUserId`). */
  currentUserId?: string;
  /** F067 (AS-110): the viewer's active role in this task's workspace.
   * F128 (AS-216): widened to the full `WorkspaceRole` so the upload
   * control can be disabled for a read-only caller — the server
   * (`uploadAttachment`) independently rejects the call regardless. */
  currentUserRole?: WorkspaceRole;
}) {
  const [localAttachments, setLocalAttachments] = useState(attachments);
  // Tracks which task's attachments are currently loaded into local state,
  // so it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as CommentList/TaskDetailSheet.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isUploading, startUploadTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();

  const isAdminOrOwner =
    currentUserRole === "owner" || currentUserRole === "admin";
  // F128 (AS-216): viewers/guests never see a usable upload control.
  const canUpload = currentUserRole
    ? canWrite({ role: currentUserRole })
    : true;

  function canDelete(attachment: TaskAttachment): boolean {
    if (!currentUserId) return false;
    if (currentUserRole && !canWrite({ role: currentUserRole })) return false;
    return attachment.uploadedBy === currentUserId || isAdminOrOwner;
  }

  function handleDelete(attachmentId: string) {
    setDeletingId(attachmentId);
    startDeleteTransition(async () => {
      const result = await deleteAttachment(attachmentId);
      if (result.ok) {
        // Remove locally so it disappears immediately for this viewer;
        // the server-side delete plus revalidatePath handles it
        // disappearing for other viewers/on reload.
        setLocalAttachments((previous) =>
          previous.filter((attachment) => attachment.id !== attachmentId),
        );
      } else {
        toast.error(result.error);
      }
      setDeletingId(null);
    });
  }

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalAttachments(attachments);
  }

  function handleFileChange(changeEvent: React.ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0];
    // Reset immediately so selecting the same file again still fires
    // onChange.
    changeEvent.target.value = "";
    if (!file) return;

    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("file", file);

    startUploadTransition(async () => {
      const result = await uploadAttachment(formData);
      if (result.ok) {
        // AS-115: append directly to local state via the pure
        // appendAttachment reducer — no page reload, no re-fetch.
        setLocalAttachments((previous) =>
          appendAttachment(previous, {
            id: result.data.id,
            taskId: result.data.taskId,
            fileName: result.data.fileName,
            fileUrl: result.data.fileUrl,
            uploadedBy: result.data.uploadedBy,
            createdAt: result.data.createdAt,
            mimeType: result.data.mimeType,
          }),
        );
        toast.success("File uploaded.");
      } else {
        toast.error(result.error);
      }
    });
  }

  async function handleOpen(attachmentId: string) {
    setOpeningId(attachmentId);
    try {
      // Signed URLs are time-limited — always mint a fresh one on click
      // rather than reusing a possibly-stale one from state.
      const result = await getAttachmentSignedUrl(attachmentId);
      if (result.ok) {
        window.open(result.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error(result.error);
      }
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Attachments</Label>

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
      ) : localAttachments.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Paperclip className="size-4" aria-hidden="true" />
          No attachments yet. Upload a file to get started.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {localAttachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-col gap-2">
              {attachment.mimeType?.startsWith("image/") && (
                <AttachmentThumbnail
                  attachmentId={attachment.id}
                  fileName={attachment.fileName}
                  onOpen={() => handleOpen(attachment.id)}
                />
              )}
              <div className="flex items-center gap-2">
              <FileText
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <button
                type="button"
                className="truncate text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60"
                disabled={openingId === attachment.id}
                onClick={() => handleOpen(attachment.id)}
              >
                {attachment.fileName}
              </button>
              <span className="text-xs text-muted-foreground">
                {uploaderLabel(attachment.uploadedBy, members)}
              </span>
              {openingId === attachment.id && (
                <Loader2
                  className="size-3.5 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              {canDelete(attachment) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-6"
                  disabled={deletingId === attachment.id}
                  aria-label="Delete attachment"
                  onClick={() => handleDelete(attachment.id)}
                >
                  {deletingId === attachment.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Label htmlFor={`attachment-upload-${taskId}`} className="sr-only">
          Upload a file
        </Label>
        <Input
          id={`attachment-upload-${taskId}`}
          type="file"
          disabled={isUploading || !canUpload}
          title={canUpload ? undefined : "Viewers can't upload files"}
          onChange={handleFileChange}
        />
        {isUploading && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
