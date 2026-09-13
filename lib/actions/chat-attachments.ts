"use server";
import { logger } from "@/lib/observability/logger";


// F11 (docs/advanced-chat-plan.md): Server Actions for uploading/removing a
// chat attachment and minting a fresh signed URL for display. Pattern
// mirrors lib/actions/attachments.ts: the raw upload/delete logic lives in
// a plain module (lib/attachments/upload-chat.ts, no "use server"
// directive) that trusts a caller-resolved `userId` -- this file is the
// only "use server" entry point into it, resolving `userId` itself from
// the caller's authenticated cookie session, never accepted as an
// argument (same BLOCKER-3 defense as the task-attachment action file).
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChatAttachmentSignedUrlSchema } from "@/lib/validation/chat-attachments";
import {
  uploadChatAttachmentForUser,
  deletePendingChatAttachmentForUser,
  type UploadChatAttachmentResult,
} from "@/lib/attachments/upload-chat";
import type { ActionOutcome } from "@/lib/actions/authz";

export type { UploadChatAttachmentResult };

const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, matches upload-chat.ts

export async function uploadChatAttachment(
  formData: FormData,
): Promise<UploadChatAttachmentResult> {
  const channelId = formData.get("channelId");
  const file = formData.get("file");

  if (typeof channelId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload request." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to attach a file." };
  }

  const arrayBuffer = await file.arrayBuffer();

  return uploadChatAttachmentForUser(user.id, {
    channelId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    arrayBuffer,
  });
}

export type RemovePendingChatAttachmentResult = ActionOutcome;

export async function removePendingChatAttachment(
  attachmentId: string,
): Promise<RemovePendingChatAttachmentResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  return deletePendingChatAttachmentForUser(user.id, attachmentId);
}

export type GetChatAttachmentSignedUrlResult = ActionOutcome<{ signedUrl: string }>;

// Mints a fresh signed URL for an existing (pending or already-sent) chat
// attachment. Same "never persist/reuse a signed URL, mint on demand"
// convention as getAttachmentSignedUrl in lib/actions/attachments.ts.
export async function getChatAttachmentSignedUrl(
  attachmentId: string,
): Promise<GetChatAttachmentSignedUrlResult> {
  const parsed = getChatAttachmentSignedUrlSchema.safeParse({ attachmentId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid attachment.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();

  const { data: attachmentRow, error: attachmentError } = await admin
    .from("message_attachments")
    .select("id, storage_path, channel_id")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (attachmentError || !attachmentRow) {
    return { ok: false, error: "Attachment not found." };
  }

  // Defense in depth (real boundary is the Storage/RLS policies on
  // message_attachments + storage.objects, see the F11 migration): the
  // caller must currently be a member of the owning channel.
  const { data: membershipRow } = await admin
    .from("channel_members")
    .select("channel_id")
    .eq("channel_id", attachmentRow.channel_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membershipRow) {
    return { ok: false, error: "Attachment not found." };
  }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(attachmentRow.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error("getChatAttachmentSignedUrl: signed URL generation failed", { error: signedUrlError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true, signedUrl: signedUrlData.signedUrl };
}
