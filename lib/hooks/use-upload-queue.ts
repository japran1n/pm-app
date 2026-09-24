"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import type { UploadProgressJob } from "@/components/task/upload-progress";
import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import { uploadFilesWithConcurrency } from "@/lib/tasks/upload-files-with-concurrency";

// The one upload-queue state machine behind <UploadProgress> rows, shared by
// the task attachment list (picker + drag-drop, F258/F259) and the comment
// composer's pasted images (F261). The two used to carry separate copies and
// the comment copy lacked the attachment list's "stuck uploading" fix: a
// Server Action that REJECTS (413 from the body-size limit, network error)
// instead of resolving `{ ok: false }` left the row spinning forever with no
// feedback. Here every job always settles.
//
// Per file: client-side validation (the same rule the server re-checks) ->
// "rejected" row without any network call; otherwise an "uploading" row that
// settles to "success" / "error". Cancel = drop the row and ignore the
// eventual result (Server Actions have no abort hook, see upload-progress.tsx).

export type UploadActionResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: string };

export const UPLOAD_FAILED_MESSAGE = "Something went wrong. Please try again in a moment.";

export type UseUploadQueueOptions<TData> = {
  upload: (file: File) => Promise<UploadActionResult<TData>>;
  onSuccess?: (file: File, data: TData) => void;
  /** Toast a client-side rejection (default true). */
  toastOnReject?: boolean;
  /** Toast a successful upload (default true). */
  toastOnSuccess?: boolean;
  /** Formats a failure toast; default prefixes the file name. */
  formatError?: (file: File, message: string) => string;
  concurrency?: number;
};

function makeJobId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useUploadQueue<TData>({
  upload,
  onSuccess,
  toastOnReject = true,
  toastOnSuccess = true,
  formatError = (file, message) => `${file.name}: ${message}`,
  concurrency = 3,
}: UseUploadQueueOptions<TData>) {
  const [jobs, setJobs] = useState<UploadProgressJob[]>([]);
  const [isUploading, startTransition] = useTransition();
  const cancelledRef = useRef<Set<string>>(new Set());

  const settle = (jobId: string, patch: Partial<UploadProgressJob>) =>
    setJobs((previous) =>
      previous.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    );

  // Returns true when the job was cancelled (and forgets it).
  const consumeCancelled = (jobId: string) => {
    if (!cancelledRef.current.has(jobId)) return false;
    cancelledRef.current.delete(jobId);
    return true;
  };

  async function uploadOne({ file, jobId }: { file: File; jobId: string }) {
    let result: UploadActionResult<TData>;
    try {
      result = await upload(file);
    } catch {
      if (consumeCancelled(jobId)) return;
      settle(jobId, { status: "error", reason: UPLOAD_FAILED_MESSAGE });
      toast.error(formatError(file, UPLOAD_FAILED_MESSAGE));
      return;
    }
    if (consumeCancelled(jobId)) return;

    if (result.ok) {
      onSuccess?.(file, result.data);
      settle(jobId, { status: "success" });
      if (toastOnSuccess) toast.success(`${file.name} uploaded.`);
    } else {
      settle(jobId, { status: "error", reason: result.error });
      toast.error(formatError(file, result.error));
    }
  }

  function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    const toSend: { file: File; jobId: string }[] = [];
    const newJobs: UploadProgressJob[] = [];

    for (const file of files) {
      const jobId = makeJobId();
      const validation = validateAttachmentFile(file);
      if (!validation.ok) {
        newJobs.push({
          id: jobId,
          fileName: file.name,
          fileSize: file.size,
          status: "rejected",
          reason: validation.reason,
        });
        if (toastOnReject) toast.error(`${file.name}: ${validation.reason}`);
        continue;
      }
      newJobs.push({ id: jobId, fileName: file.name, fileSize: file.size, status: "uploading" });
      toSend.push({ file, jobId });
    }

    setJobs((previous) => [...previous, ...newJobs]);
    if (toSend.length === 0) return;

    startTransition(async () => {
      await uploadFilesWithConcurrency(toSend, uploadOne, concurrency);
    });
  }

  function cancel(jobId: string) {
    cancelledRef.current.add(jobId);
    setJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  function dismiss(jobId: string) {
    setJobs((previous) => previous.filter((job) => job.id !== jobId));
  }

  return { jobs, isUploading, uploadFiles, cancel, dismiss };
}
