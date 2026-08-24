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

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { Loader2, Paperclip, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAttachment,
  getAttachmentSignedUrl,
  uploadAttachment,
} from "@/lib/actions/attachments";
import { appendAttachment } from "@/lib/tasks/append-attachment";
import { uploadFilesWithConcurrency } from "@/lib/tasks/upload-files-with-concurrency";
import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UploadProgress,
  type UploadProgressJob,
} from "@/components/task/upload-progress";
import { ImageLightbox } from "@/components/task/image-lightbox";

// F258 (AS-501, AS-503): the imperative handle AttachmentDropzone
// (components/task/attachment-dropzone.tsx) calls into so a native-drag
// drop can funnel through the exact same upload path the file-picker
// input already uses below, rather than a second, parallel upload
// implementation.
export type AttachmentListHandle = {
  uploadFiles: (files: File[]) => void;
};

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

export const AttachmentList = forwardRef<AttachmentListHandle, {
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
}>(function AttachmentList({
  taskId,
  attachments,
  members,
  loading = false,
  error = null,
  onRetry,
  currentUserId,
  currentUserRole,
}, ref) {
  const [localAttachments, setLocalAttachments] = useState(attachments);
  // Tracks which task's attachments are currently loaded into local state,
  // so it can be re-synced below without an Effect — same "adjust state
  // during render on prop change" convention as CommentList/TaskDetailSheet.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isUploading, startUploadTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  // F260 (AS-505, AS-506): id of the image attachment currently shown in
  // the full-size lightbox, or null when it's closed.
  const [lightboxOpenId, setLightboxOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();
  // F259 (AS-504, AS-507): per-file progress/rejection rows shown below
  // the upload control while uploadFiles() is running. Populated with a
  // "rejected" job immediately (before any network call) for a file that
  // fails client-side validation, and an "uploading" job that settles to
  // "success"/"error" for every file that actually gets sent.
  const [uploadJobs, setUploadJobs] = useState<UploadProgressJob[]>([]);
  // Job ids whose in-flight Server Action result should be ignored once it
  // settles (the "cancel" affordance below — the underlying Server Action
  // call itself has no abort hook, see upload-progress.tsx's header
  // comment, so cancelling means "don't act on this result", not "stop
  // the network request").
  const cancelledJobIdsRef = useRef<Set<string>>(new Set());

  function makeJobId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

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

  // F258 (AS-501, AS-503): shared single-file upload used by both the
  // file-picker input and the drag-drop path below, so a drop funnels
  // through the exact same Server Action call + local-state append + toast
  // feedback as the pre-existing picker — no second upload implementation.
  async function uploadOneFile(job: { file: File; jobId: string }) {
    const { file, jobId } = job;
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("file", file);

    const result = await uploadAttachment(formData);

    // F259: a cancelled job's result is ignored entirely — no state
    // update, no toast — since its row was already removed from
    // uploadJobs the moment cancel was clicked.
    if (cancelledJobIdsRef.current.has(jobId)) {
      cancelledJobIdsRef.current.delete(jobId);
      return;
    }

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
      setUploadJobs((previous) =>
        previous.map((existingJob) =>
          existingJob.id === jobId
            ? { ...existingJob, status: "success" }
            : existingJob,
        ),
      );
      toast.success(`${file.name} uploaded.`);
    } else {
      // AS-503: one bad file in a multi-file drop must not silently
      // swallow the others — each failure gets its own toast naming the
      // file, matching this component's existing single-upload failure
      // convention (plain-language sonner toast, control stays
      // actionable). AS-507: the server's own error message (from Zod
      // validation or the Storage/DB call) is shown verbatim in the
      // progress row too, so a server-side rejection explains why exactly
      // like a client-side one does.
      setUploadJobs((previous) =>
        previous.map((existingJob) =>
          existingJob.id === jobId
            ? { ...existingJob, status: "error", reason: result.error }
            : existingJob,
        ),
      );
      toast.error(`${file.name}: ${result.error}`);
    }
  }

  // F258 (AS-503): uploads every file with a concurrency cap so a 10-file
  // drop doesn't fire 10 parallel Server Action calls at once. Shared by
  // the picker input (below) and AttachmentDropzone's onFilesDropped via
  // the imperative handle exposed below.
  //
  // F259 (AS-504, AS-507): every file is first validated client-side
  // (validateAttachmentFile — the exact same size/MIME rules the Server
  // Action re-checks). A file that fails is never sent — it gets an
  // immediate "rejected" progress row explaining why and no Server
  // Action call is ever made for it, so it is structurally impossible for
  // a client-rejected file to leave a partial `attachments` row (nothing
  // was ever inserted, no Storage upload was ever attempted). Files that
  // pass get an "uploading" row that settles to "success"/"error" as
  // uploadOneFile resolves.
  function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    if (!canUpload) {
      toast.error("Viewers don't have permission to upload files.");
      return;
    }

    const jobsToUpload: { file: File; jobId: string }[] = [];
    const newProgressJobs: UploadProgressJob[] = [];

    for (const file of files) {
      const jobId = makeJobId();
      const validation = validateAttachmentFile(file);

      if (!validation.ok) {
        newProgressJobs.push({
          id: jobId,
          fileName: file.name,
          fileSize: file.size,
          status: "rejected",
          reason: validation.reason,
        });
        toast.error(`${file.name}: ${validation.reason}`);
        continue;
      }

      newProgressJobs.push({
        id: jobId,
        fileName: file.name,
        fileSize: file.size,
        status: "uploading",
      });
      jobsToUpload.push({ file, jobId });
    }

    setUploadJobs((previous) => [...previous, ...newProgressJobs]);

    if (jobsToUpload.length === 0) return;

    startUploadTransition(async () => {
      await uploadFilesWithConcurrency(jobsToUpload, uploadOneFile, 3);
    });
  }

  function handleCancelUploadJob(jobId: string) {
    cancelledJobIdsRef.current.add(jobId);
    setUploadJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  function handleDismissUploadJob(jobId: string) {
    setUploadJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  // No deps array: `uploadFiles` closes over `canUpload`/`taskId`, which
  // can change between renders, so the handle must always point at the
  // latest closure rather than a stale one captured on first mount.
  useImperativeHandle(ref, () => ({ uploadFiles }));

  function handleFileChange(changeEvent: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(changeEvent.target.files ?? []);
    // Reset immediately so selecting the same file(s) again still fires
    // onChange.
    changeEvent.target.value = "";
    uploadFiles(files);
  }

  // F260 (AS-505, AS-506): all image attachments for this task, in display
  // order — the lightbox's next/previous navigates within this list only.
  const imageAttachments = localAttachments.filter((attachment) =>
    attachment.mimeType?.startsWith("image/"),
  );

  async function handleOpen(attachmentId: string) {
    const attachment = localAttachments.find((a) => a.id === attachmentId);

    // AS-506: clicking an image attachment opens the in-app lightbox
    // preview, not a new browser tab. Non-image attachments keep the
    // existing "open in a new tab" behaviour.
    if (attachment?.mimeType?.startsWith("image/")) {
      setLightboxOpenId(attachmentId);
      return;
    }

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
          multiple
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

      {/* F259 (AS-504, AS-507): per-file progress/rejection rows. */}
      <UploadProgress
        jobs={uploadJobs}
        onCancel={handleCancelUploadJob}
        onDismiss={handleDismissUploadJob}
      />

      {/* F260 (AS-505, AS-506): full-size preview, opened by clicking an
          image attachment's thumbnail or filename. */}
      <ImageLightbox
        images={imageAttachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
        }))}
        openId={lightboxOpenId}
        onClose={() => setLightboxOpenId(null)}
        onNavigate={(id) => setLightboxOpenId(id)}
      />
    </div>
  );
});
