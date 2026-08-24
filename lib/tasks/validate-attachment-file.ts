// F259 (AS-507): client-side pre-flight validation for a file about to be
// uploaded, run BEFORE any Server Action call is made — so an obviously
// oversized or disallowed-type file never reaches the network, gets a
// clear reason shown immediately, and (since no Storage/DB call ever
// happens for it) can never leave a partial `attachments` row behind.
//
// Deliberately reuses the exact same size/MIME rules the server enforces
// (MAX_ATTACHMENT_SIZE_BYTES, ALLOWED_ATTACHMENT_MIME_TYPES from
// lib/validation/attachments.ts) rather than a second, drifting copy of
// the limits — single source of truth, per this feature's clarified
// "no second source of truth" resolution rule. This client check never
// stands alone: uploadAttachmentForUser re-validates the exact same rules
// server-side (defense in depth) regardless of what this function says.
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/validation/attachments";

export type AttachmentFileValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateAttachmentFile(file: {
  size: number;
  type: string;
  name: string;
}): AttachmentFileValidationResult {
  if (file.size <= 0) {
    return { ok: false, reason: "File is empty." };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      reason: `File must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    };
  }

  if (
    !(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)
  ) {
    return { ok: false, reason: "This file type is not allowed." };
  }

  return { ok: true };
}
