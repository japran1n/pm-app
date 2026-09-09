"use client";

// F259 (AS-504, AS-507): per-file upload progress rows shown while
// AttachmentList's uploadFiles() is running, plus rejected-before-upload
// rows for files that failed client-side validation.
//
// Byte-level progress is NOT available here: the upload path is
// lib/actions/attachments.ts's `uploadAttachment` Server Action, invoked
// via a plain `await` inside a React transition (see AttachmentList's
// uploadOneFile/uploadFiles). Next.js Server Actions are POSTed through
// the framework's own internal fetch with no exposed upload-progress
// event/callback (unlike, say, XMLHttpRequest.upload.onprogress or a
// direct-to-Storage signed-upload client) — there is no hook this
// component could wire a percentage to without replacing the whole
// upload path with a different transport, which is out of scope for this
// feature (F258 established the Server Action funnel; this feature only
// adds progress/rejection UI on top of it).
//
// Per the feature's clarified Notes-resolution rule ("if the storage
// client cannot report progress, an indeterminate per-file state is
// acceptable — say which one was implemented"): this component shows an
// INDETERMINATE per-file state — a spinner + file name + size while
// "uploading", settling to a checkmark on success or an error icon +
// reason on failure/rejection. This satisfies AS-504 ("progress is shown
// per file") without a fabricated percentage that wouldn't reflect real
// bytes transferred.
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

export type UploadProgressStatus = "uploading" | "success" | "error" | "rejected";

export type UploadProgressJob = {
  id: string;
  fileName: string;
  fileSize: number;
  status: UploadProgressStatus;
  /** Populated for "error"/"rejected" — the plain-language reason shown to
   * the user (AS-507: a rejected upload explains why). */
  reason?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadProgress({
  jobs,
  onCancel,
  onDismiss,
}: {
  jobs: UploadProgressJob[];
  /** Called for a job still "uploading" — the in-flight Server Action call
   * cannot itself be aborted (no AbortController hook on this transport,
   * see this file's header comment), so cancelling marks the job so its
   * eventual result is ignored (no toast, no attachment appended) and
   * immediately reflects "cancelled" in the UI rather than waiting for the
   * network call to settle. */
  onCancel: (jobId: string) => void;
  /** Called for a settled job ("success" | "error" | "rejected") to remove
   * its row from the list. */
  onDismiss: (jobId: string) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <ul
      data-testid="upload-progress-list"
      className="flex flex-col gap-1.5"
      aria-label="Upload progress"
    >
      {jobs.map((job) => (
        <li
          key={job.id}
          data-testid="upload-progress-row"
          data-status={job.status}
          className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
        >
          {job.status === "uploading" && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
          {job.status === "success" && (
            <CheckCircle2
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          )}
          {(job.status === "error" || job.status === "rejected") && (
            <XCircle
              className="size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{job.fileName}</span>
            <span className="text-xs text-muted-foreground">
              {job.status === "uploading" && (
                <>{formatBytes(job.fileSize)} &middot; uploading&hellip;</>
              )}
              {job.status === "success" && <>{formatBytes(job.fileSize)} &middot; uploaded</>}
              {(job.status === "error" || job.status === "rejected") && (
                <span className="text-destructive">{job.reason ?? "Upload failed."}</span>
              )}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={job.status === "uploading" ? `Cancel ${job.fileName}` : `Dismiss ${job.fileName}`}
            onClick={() =>
              job.status === "uploading" ? onCancel(job.id) : onDismiss(job.id)
            }
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
