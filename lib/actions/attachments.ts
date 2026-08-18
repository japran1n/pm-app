"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadAttachmentSchema } from "@/lib/validation/attachments";
import { requireActiveMembership } from "@/lib/auth/require-membership";

// Storage bucket + path convention fixed by F064
// (supabase/migrations/20260818050100_create_attachments.sql): bucket
// `task-attachments`, object path `{task_id}/{filename}` — the *first*
// path segment MUST be the task's UUID, because the bucket's INSERT RLS
// policy parses it out of the object name (`split_part(name, '/', 1)`) to
// authorize the upload (there is no `attachments` row yet at upload time
// for a SELECT-style join to match against). Do not change this shape
// without also updating that policy.
const ATTACHMENTS_BUCKET = "task-attachments";

// AS-108: signed URLs are time-limited, not permanent. 1 hour is long
// enough to cover "display immediately after upload" (and a normal viewing
// session) without leaving a long-lived bearer link floating around in
// client state/logs.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export type UploadAttachmentResult =
  | {
      ok: true;
      data: {
        id: string;
        taskId: string;
        fileName: string;
        fileUrl: string;
        uploadedBy: string;
        createdAt: string;
        signedUrl: string;
      };
    }
  | { ok: false; error: string };

// Uploads a file attachment to a task (F065: AS-105, AS-108, AS-112,
// AS-113). Pattern mirrors lib/actions/comments.ts's addComment: Zod-
// validated input, membership re-checked server-side (defense in depth,
// AS-143), admin client used for the actual Storage upload + insert,
// discriminated-union return, generic user-facing errors with details only
// logged server-side (AS-146).
//
// Takes a FormData because Server Actions receive `File` objects through
// FormData, not as plain function arguments — the browser client is
// expected to build `new FormData()` with `taskId` and `file` fields and
// call this action with it (e.g. via a `<form action={uploadAttachment}>`
// bound with `.bind(null)` or invoked directly from a client component).
//
// AS-112/AS-113 (size + MIME) are validated *before* any Storage call is
// made — the file never leaves this function's early-return path if it
// fails either check, satisfying "rejected ... before the upload
// completes".
export async function uploadAttachment(
  formData: FormData,
): Promise<UploadAttachmentResult> {
  const taskId = formData.get("taskId");
  const file = formData.get("file");

  if (typeof taskId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload request." };
  }

  const parsed = uploadAttachmentSchema.safeParse({
    taskId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to upload a file." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace so membership is checked
  // against the real workspace, never one supplied (or omitted) by the
  // client. Only non-deleted tasks are eligible, same convention as
  // addComment.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects(workspace_id)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  // Defense in depth (AS-105): re-check the caller is an active member of
  // the task's workspace, server-side, rather than trusting that the UI
  // only shows the upload control to members of the active workspace. The
  // Storage bucket's own INSERT policy (F064) backs this up as the real
  // enforcement boundary, since the admin client below bypasses RLS.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to upload files to this task.",
    };
  }

  // Path convention fixed by F064: first segment is the task id. A random
  // suffix is appended to the stored object name (not the displayed
  // `file_name`) so two uploads of a same-named file to the same task
  // never collide in Storage.
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${parsed.data.taskId}/${uniqueSuffix}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: parsed.data.mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error("uploadAttachment: storage upload failed:", uploadError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // file_url stores the Storage object path (not a public URL) — AS-106,
  // AS-108: the bucket is private and any display of this attachment must
  // generate a fresh signed URL from this path, never store/reuse a
  // permanent link.
  const { data: inserted, error: insertError } = await admin
    .from("attachments")
    .insert({
      task_id: parsed.data.taskId,
      file_url: objectPath,
      file_name: parsed.data.fileName,
      uploaded_by: user.id,
    })
    .select("id, task_id, file_url, file_name, uploaded_by, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("uploadAttachment: row insert failed:", insertError);
    // Best-effort cleanup so a failed row insert doesn't leave an orphaned
    // Storage object behind (mirrors AS-114's "no orphans accumulate
    // silently" intent, applied here to the upload-failure path too).
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([objectPath]);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-108: return a time-limited signed URL for immediate display, never
  // a permanent public URL.
  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error(
      "uploadAttachment: signed URL generation failed:",
      signedUrlError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      // Non-fatal cache-freshness rationale, same as addComment.
      console.error(
        "uploadAttachment: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      taskId: inserted.task_id,
      fileName: inserted.file_name,
      fileUrl: inserted.file_url,
      uploadedBy: inserted.uploaded_by,
      createdAt: inserted.created_at,
      signedUrl: signedUrlData.signedUrl,
    },
  };
}

// Generates a fresh signed URL for an existing attachment (AS-108). Any UI
// that displays/lists attachments must call this rather than persisting a
// URL, since the bucket is private and signed URLs expire.
export type GetAttachmentSignedUrlResult =
  | { ok: true; signedUrl: string }
  | { ok: false; error: string };

export async function getAttachmentSignedUrl(
  attachmentId: string,
): Promise<GetAttachmentSignedUrlResult> {
  if (typeof attachmentId !== "string" || !attachmentId) {
    return { ok: false, error: "Invalid attachment." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();

  const { data: attachmentRow, error: attachmentError } = await admin
    .from("attachments")
    .select("id, file_url, tasks(deleted_at, projects(workspace_id))")
    .eq("id", attachmentId)
    .maybeSingle();

  if (attachmentError || !attachmentRow) {
    return { ok: false, error: "Attachment not found." };
  }

  const task = attachmentRow.tasks as
    | {
        deleted_at: string | null;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }
    | {
        deleted_at: string | null;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!taskRow || taskRow.deleted_at || !workspaceId) {
    return { ok: false, error: "Attachment not found." };
  }

  // Defense in depth (AS-107): re-check membership server-side before
  // minting a signed URL, even though the Storage RLS policy (F064) is the
  // real enforcement boundary for direct object access.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to view this file." };
  }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachmentRow.file_url, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error(
      "getAttachmentSignedUrl: signed URL generation failed:",
      signedUrlError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true, signedUrl: signedUrlData.signedUrl };
}
