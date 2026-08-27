import { z } from "zod";

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/validation/attachments";

// F11 (docs/advanced-chat-plan.md): chat attachment upload validation.
// Reuses the exact same size cap and MIME allow-list as task attachments
// (lib/validation/attachments.ts) per the plan's explicit "reuse
// validateAttachmentFile / MAX_ATTACHMENT_SIZE_BYTES from the existing
// validation" instruction -- there is no product reason for chat uploads
// to have a different limit than task uploads.
export { ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_SIZE_BYTES };

export const uploadChatAttachmentSchema = z.object({
  channelId: z.string().uuid("Invalid channel."),
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

export type UploadChatAttachmentInput = z.infer<
  typeof uploadChatAttachmentSchema
>;

export const getChatAttachmentSignedUrlSchema = z.object({
  attachmentId: z.string().uuid("Invalid attachment."),
});

export const deleteChatAttachmentSchema = z.object({
  attachmentId: z.string().uuid("Invalid attachment."),
});
