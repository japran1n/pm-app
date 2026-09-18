import { z } from "zod";

// Validates uploadAttachment input (F065: AS-105, AS-112, AS-113). Mirrors
// the file-layout convention established by lib/validation/comments.ts.
//
// AS-112: max file size. Aligned to 4MB to match next.config.ts's Server
// Action `bodySizeLimit` (4.5MB) — Vercel hard-caps request bodies at
// ~4.5MB regardless of what bodySizeLimit says, so this app-level limit
// must stay under that ceiling with headroom for multipart encoding
// overhead, or an upload between the old app-level limit and the actual
// platform/body-size limit would pass client-side validation only to 413
// on the server. Not sourced from a tech-decisions.md value (none was
// specified for this feature) — documented here as the deliberate choice.
export const MAX_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

// P2-37: portal deliverables are design artefacts (zip exports, Figma
// handoff packages, etc.) and need a higher size ceiling than task
// attachments. 20MB is a reasonable limit for design files while staying
// well under Supabase Storage's own upload limits. The Server Action that
// handles portal deliverables (`deliverPortalDeliverable`) uses its own
// bodySizeLimit in next.config.ts (already set to accommodate this) and
// never goes through `uploadAttachmentForUser` — so this constant is the
// only gate for deliverables, not a shared one.
export const MAX_DELIVERABLE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

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
  // Audit ARCH-010: image/svg+xml removed — an uploaded SVG opened from a
  // signed Storage URL executes embedded script on the Storage origin.
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

// P2-37: portal deliverable MIME allowlist. Extends the task attachment
// allowlist with archive and generic binary formats that design-handoff
// workflows produce. SVG is deliberately excluded: ARCH-010 bans
// `image/svg+xml` from all Storage uploads (stored XSS on the Storage
// origin if the signed URL is opened directly). `application/octet-stream`
// is the catch-all for Figma export packages and similar tools that emit
// a generic binary content-type regardless of the container format.
export const PORTAL_DELIVERABLE_ALLOWED_TYPES = [
  ...ALLOWED_ATTACHMENT_MIME_TYPES,
  // Archive formats
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  // Generic binary (Figma exports and similar design-tool outputs)
  "application/octet-stream",
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

// Validates getAttachmentSignedUrl input (AS-108/AS-146). Same shape as
// deleteAttachmentSchema's id field — added so this action validates via
// Zod like every other Server Action in this file, instead of a bespoke
// `typeof` check.
export const getAttachmentSignedUrlSchema = z.object({
  attachmentId: z.string().uuid("Invalid attachment."),
});

export type GetAttachmentSignedUrlInput = z.infer<
  typeof getAttachmentSignedUrlSchema
>;
