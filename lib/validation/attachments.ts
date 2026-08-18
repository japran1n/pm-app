import { z } from "zod";

// Validates uploadAttachment input (F065: AS-105, AS-112, AS-113). Mirrors
// the file-layout convention established by lib/validation/comments.ts.
//
// AS-112: max file size. 10MB is chosen as a reasonable v1-scale default —
// large enough for the "common office docs" the allowlist below covers
// (photos, scanned PDFs, slide decks), small enough that a single upload
// stays well under typical serverless/Server Action body-size limits and
// keeps the private Storage bucket from filling with oversized files. Not
// sourced from a tech-decisions.md value (none was specified for this
// feature) — documented here as the deliberate choice.
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// AS-113: allowed MIME types. Covers the three categories called out in
// this feature's task: images, PDFs, and common office documents.
// Deliberately a closed allowlist (not a denylist) so an unanticipated
// executable/script MIME type is rejected by default rather than
// accidentally permitted.
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // PDF
  "application/pdf",
  // Plain text / CSV
  "text/plain",
  "text/csv",
  // Microsoft Office (legacy + OOXML)
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const uploadAttachmentSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  fileName: z
    .string()
    .trim()
    .min(1, "File name is required.")
    .max(255, "File name must be 255 characters or fewer."),
  fileSize: z
    .number()
    .int()
    .positive("File is empty.")
    .max(
      MAX_ATTACHMENT_SIZE_BYTES,
      `File must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    ),
  mimeType: z
    .string()
    .refine(
      (value) =>
        (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value),
      { message: "This file type is not allowed." },
    ),
});

export type UploadAttachmentInput = z.infer<typeof uploadAttachmentSchema>;

// Validates deleteAttachment input (F067: AS-110, AS-111, AS-114). Mirrors
// deleteCommentSchema's shape from lib/validation/comments.ts.
export const deleteAttachmentSchema = z.object({
  attachmentId: z.string().uuid("Invalid attachment."),
});

export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;
