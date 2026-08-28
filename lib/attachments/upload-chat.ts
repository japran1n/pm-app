import { logger } from "@/lib/observability/logger";

// F11 (docs/advanced-chat-plan.md): shared chat-attachment upload
// implementation. Plain (non-"use server") module for the same reason
// lib/attachments/upload.ts documents at its own file header (M17
// scrutiny BLOCKER-3): every exported async function inside a "use server"
// module is a client-invocable Server Action endpoint reachable by id
// regardless of whether any UI calls it. `userId` here is always resolved
// by the caller from a real authenticated session/JWT before this function
// runs -- it performs no identity verification of its own.
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadChatAttachmentSchema } from "@/lib/validation/chat-attachments";

// Path convention fixed by supabase/migrations/20260904070000_chat_attachments.sql:
// bucket `chat-attachments`, object path `{channel_id}/{uuid}-{filename}` --
// the first path segment MUST be the channel id, because the bucket's
// INSERT/SELECT RLS policies parse it out of the object name to authorize
// against channel_members (there is no message_attachments row to join
// through yet at upload time). Do not change this shape without also
// updating those policies.
const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";

// Same TTL as lib/actions/attachments.ts's SIGNED_URL_TTL_SECONDS -- signed
// URLs are time-limited, never a permanent public link, same rationale
// (AS-108-equivalent for chat attachments).
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export type UploadChatAttachmentResult =
  | {
      ok: true;
      data: {
        id: string;
        channelId: string;
        fileName: string;
        mimeType: string | null;
        fileSize: number | null;
        uploadedBy: string;
        createdAt: string;
        signedUrl: string;
      };
    }
  | { ok: false; error: string };

// Re-checks the caller has an active `channel_members` row for `channelId`
// -- same predicate lib/actions/chat-messages.ts's requireChannelMembership
// and this feature's RLS policies enforce, re-verified here as
// defense-in-depth (this repo's AS-143 convention).
async function requireChannelMembership(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("channel_members")
    .select("channel_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();

  return !error && !!data;
}

// The shared chat-attachment upload path (F11). Mirrors
// lib/attachments/upload.ts's uploadAttachmentForUser: Zod validation,
// a re-check of the real byte length against the declared one (defense
// against a caller lying about fileSize), storage-first-then-insert with
// best-effort cleanup on a failed row insert so a broken upload never
// leaves an orphaned Storage object nor an empty DB row (same invariant
// F259/F294's handoffs establish for task attachments).
export async function uploadChatAttachmentForUser(
  userId: string,
  input: {
    channelId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    arrayBuffer: ArrayBuffer;
  },
): Promise<UploadChatAttachmentResult> {
  const parsed = uploadChatAttachmentSchema.safeParse({
    channelId: input.channelId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  // Defense in depth beyond Zod, same rationale as uploadAttachmentForUser:
  // re-check the real byte length independent of the caller-declared size.
  const realSizeParsed = uploadChatAttachmentSchema.shape.fileSize.safeParse(
    input.arrayBuffer.byteLength,
  );
  if (!realSizeParsed.success) {
    return {
      ok: false,
      error: realSizeParsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  const admin = createAdminClient();

  const isMember = await requireChannelMembership(
    admin,
    parsed.data.channelId,
    userId,
  );

  if (!isMember) {
    return {
      ok: false,
      error: "You don't have permission to attach files in this channel.",
    };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${parsed.data.channelId}/${uniqueSuffix}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(objectPath, input.arrayBuffer, {
      contentType: parsed.data.mimeType,
      upsert: false,
    });

  if (uploadError) {
    logger.error("uploadChatAttachment: storage upload failed", { error: uploadError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // message_id is intentionally left null here -- it's filled in by
  // sendMessage (lib/actions/chat-messages.ts) once the message itself is
  // inserted (see this feature's migration file header comment for the
  // "upload before send" rationale).
  const { data: inserted, error: insertError } = await admin
    .from("message_attachments")
    .insert({
      channel_id: parsed.data.channelId,
      message_id: null,
      storage_path: objectPath,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      file_size: parsed.data.fileSize,
      uploaded_by: userId,
    })
    .select("id, channel_id, file_name, mime_type, file_size, uploaded_by, created_at")
    .single();

  if (insertError || !inserted) {
    logger.error("uploadChatAttachment: row insert failed", { error: insertError });
    // Storage-first-then-insert cleanup on failure, same invariant as
    // uploadAttachmentForUser -- no orphaned Storage object survives a
    // failed row insert.
    await admin.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([objectPath]);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error("uploadChatAttachment: signed URL generation failed", { error: signedUrlError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      channelId: inserted.channel_id,
      fileName: inserted.file_name,
      mimeType: inserted.mime_type,
      fileSize: inserted.file_size,
      uploadedBy: inserted.uploaded_by,
      createdAt: inserted.created_at,
      signedUrl: signedUrlData.signedUrl,
    },
  };
}

// Removes a still-pending (never sent) attachment -- used when the user
// removes a thumbnail preview from the composer before sending. Only the
// uploader may remove their own pending attachment, and only while it is
// still unlinked (message_id is null) -- once a message references it,
// deleting is out of this feature's scope (mirrors "no delete of a sent
// attachment" -- not requested by the plan's acceptance criteria).
export async function deletePendingChatAttachmentForUser(
  userId: string,
  attachmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("message_attachments")
    .select("id, storage_path, uploaded_by, message_id")
    .eq("id", attachmentId)
    .maybeSingle();

  if (existingError || !existing) {
    return { ok: false, error: "Attachment not found." };
  }

  if (existing.uploaded_by !== userId || existing.message_id !== null) {
    return { ok: false, error: "This attachment can no longer be removed." };
  }

  // Storage-first (same AS-114-equivalent ordering rationale as
  // deleteAttachment in lib/actions/attachments.ts).
  const { error: storageError } = await admin.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .remove([existing.storage_path]);

  if (storageError) {
    logger.error("deletePendingChatAttachment: storage removal failed", { error: storageError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: deleteError } = await admin
    .from("message_attachments")
    .delete()
    .eq("id", attachmentId);

  if (deleteError) {
    logger.error("deletePendingChatAttachment: row delete failed after storage removal succeeded " +
        `(attachment ${attachmentId}):`, { error: deleteError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true };
}
