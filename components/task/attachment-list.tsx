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

import { useState, useTransition } from "react";
import { Loader2, Paperclip, FileText } from "lucide-react";
import { toast } from "sonner";

import {
  getAttachmentSignedUrl,
  uploadAttachment,
} from "@/lib/actions/attachments";
import { appendAttachment } from "@/lib/tasks/append-attachment";
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

export function AttachmentList({
  taskId,
  attachments,
  members,
  loading = false,
  error = null,
  onRetry,
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
}) {
  const [localAttachments, setLocalAttachments] = useState(attachments);
  // Tracks which task's attachments are currently loaded into local state,
  // so it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as CommentList/TaskDetailSheet.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isUploading, startUploadTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);

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
            <li key={attachment.id} className="flex items-center gap-2">
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
          disabled={isUploading}
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
