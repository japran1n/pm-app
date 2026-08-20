"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteAttachmentSchema,
  getAttachmentSignedUrlSchema,
  uploadAttachmentSchema,
} from "@/lib/validation/attachments";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to upload a file." };
  }

  const arrayBuffer = await file.arrayBuffer();

  return uploadAttachmentForUser(user.id, {
    taskId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    arrayBuffer,
  });
}

// F294 (AS-559, AS-566, AS-567): the shared upload code path, factored out
// of uploadAttachment() so app/api/extension/attachments/route.ts (the QA
// feedback extension's screenshot-attachment endpoint) can attach a file to
// a task through the exact same validation/Storage/insert logic the web
// app's Server Action uses, without a parallel implementation — same
// rationale as F292's createTaskForUser extraction from createTask() above.
// The only difference from the Server Action is *how the caller's identity
// is resolved*: the web app resolves it from the cookie session, the
// extension route resolves it from a bearer JWT — both hand this function
// an already-verified userId and a real ArrayBuffer, and nothing else about
// identity is ever taken from caller-supplied input.
//
// `options.objectPathOverride` is a test-only injection point (see
// tests/integration/extension-attachments.test.ts's AS-567 case) used to
// force a deterministic real Storage-layer conflict (two uploads racing for
// the exact same object path) so the "no orphaned row survives a failed
// upload" invariant can be proven against the real Supabase Storage API
// rather than asserted from reading the code. No production caller passes
// this — every real call lets the function generate its own random suffix,
// exactly as before this feature.
export async function uploadAttachmentForUser(
  userId: string,
  input: {
    taskId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    arrayBuffer: ArrayBuffer;
  },
  options?: { objectPathOverride?: string },
): Promise<UploadAttachmentResult> {
  const parsed = uploadAttachmentSchema.safeParse({
    taskId: input.taskId,
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
    userId,
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
  // never collide in Storage. See this function's doc comment for the
  // test-only `objectPathOverride` escape hatch.
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath =
    options?.objectPathOverride ??
    `${parsed.data.taskId}/${uniqueSuffix}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectPath, input.arrayBuffer, {
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
      uploaded_by: userId,
    })
    .select("id, task_id, file_url, file_name, uploaded_by, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("uploadAttachment: row insert failed:", insertError);
    // Best-effort cleanup so a failed row insert doesn't leave an orphaned
    // Storage object behind (mirrors AS-114's "no orphans accumulate
    // silently" intent, applied here to the upload-failure path too, and is
    // the same invariant F294's AS-567 depends on for the "row insert fails
    // after Storage succeeds" half of the failure space).
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
  const parsedInput = getAttachmentSignedUrlSchema.safeParse({ attachmentId });

  if (!parsedInput.success) {
    return {
      ok: false,
      error: parsedInput.error.issues[0]?.message ?? "Invalid attachment.",
    };
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

export type DeleteAttachmentResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

// Deletes an attachment (F067: AS-110, AS-111, AS-114). Pattern mirrors
// deleteComment in lib/actions/comments.ts: Zod-validated input, the
// owning task/project/workspace and the row's `uploaded_by` looked up
// server-side (never trusted from the client), author-or-admin
// authorization, admin client for the actual mutation, discriminated-union
// return, generic user-facing errors with details only logged server-side
// (AS-146).
//
// AS-110: the attachment's own uploader may always delete it, regardless
// of role. An admin/owner of the workspace may delete any attachment in
// that workspace, regardless of who uploaded it. AS-111: anyone else — a
// different regular member — is rejected, both by this check and (as
// defense in depth) by the Storage/RLS policies from F064, since the
// admin client below bypasses RLS.
//
// AS-114 ("no permanently orphaned unreferenced files accumulate silently
// without at least being logged"): unlike a plain row delete, this
// attachment's row is the *only* reference to its Storage object (F064:
// bucket `task-attachments`, object path `{task_id}/{filename}` — no other
// row/table points at that path). That makes the ordering of the two
// deletes matter, and the two possible orders fail differently:
//
//   - Storage-first (chosen here): if the Storage delete fails, we abort
//     before touching the row, so the row keeps pointing at a file that
//     still exists — nothing is orphaned, just deleted (return an error,
//     the caller may retry). If the Storage delete succeeds but the
//     subsequent row delete fails, the row is left pointing at a URL that
//     404s — a visible, loud failure the next time anyone tries to open
//     it (getAttachmentSignedUrl would still mint a URL, but opening it
//     404s), not a silent one. This is logged via console.error below.
//   - Row-first: if the row delete succeeds but the Storage delete then
//     fails, the Storage object is left behind with *no row pointing at
//     it at all* — nothing will ever again reference that path, so
//     nothing will ever notice or retry the cleanup. That is exactly the
//     silent, unbounded accumulation AS-114 is written to prevent.
//
// Storage-first was chosen because its failure mode degrades to a
// detectable dangling reference (bad) rather than an untraceable orphan
// (worse, and the literal thing AS-114 prohibits). The row-delete-failure
// case is still logged to the server console (Sentry-equivalent per this
// codebase's error-handling convention) so it is never *silent* even in
// its worst case.
export async function deleteAttachment(
  attachmentId: string,
): Promise<DeleteAttachmentResult> {
  const parsed = deleteAttachmentSchema.safeParse({ attachmentId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid attachment.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a file." };
  }

  const admin = createAdminClient();

  // Look up the attachment's owning task/project/workspace and its
  // uploader, so both the authorization check and "not found" behaviour
  // are based on real server-side data, never client-supplied fields.
  const { data: attachmentRow, error: attachmentError } = await admin
    .from("attachments")
    .select("id, file_url, uploaded_by, tasks(deleted_at, projects(workspace_id))")
    .eq("id", parsed.data.attachmentId)
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

  if (!taskRow || !workspaceId) {
    return { ok: false, error: "Attachment not found." };
  }

  const isUploader = attachmentRow.uploaded_by === user.id;

  // AS-110: the uploader may always delete their own attachment. AS-111:
  // anyone else needs to be an admin/owner of the workspace.
  if (!isUploader) {
    const adminMembership = await requireWorkspaceAdmin(
      admin,
      workspaceId,
      user.id,
    );
    if (!adminMembership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this attachment.",
      };
    }
  } else {
    // Even the uploader must still be an active member (defense in depth
    // — e.g. a removed member should not retain delete rights on their
    // old uploads), same convention as deleteComment's author branch.
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (!membership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this attachment.",
      };
    }
  }

  // Storage-first (see the AS-114 rationale in this function's doc
  // comment above). A failure here aborts before the row is touched, so
  // at worst the row still points at a file that still exists.
  const { error: storageError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachmentRow.file_url]);

  if (storageError) {
    console.error(
      "deleteAttachment: storage removal failed:",
      storageError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: deleted, error: deleteError } = await admin
    .from("attachments")
    .delete()
    .eq("id", parsed.data.attachmentId)
    .select("id")
    .maybeSingle();

  if (deleteError || !deleted) {
    // The Storage object is already gone at this point. This is a
    // dangling-reference row (visible/loud on next access), not a
    // silently-accumulating orphaned file — see the AS-114 rationale
    // above. Logged so it is never silent even in this worst case.
    console.error(
      "deleteAttachment: row delete failed after storage removal succeeded " +
        `(attachment ${parsed.data.attachmentId}, path ${attachmentRow.file_url}):`,
      deleteError,
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
      // Non-fatal cache-freshness rationale, same as the other actions in
      // this file.
      console.error(
        "deleteAttachment: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true, data: { id: deleted.id } };
}
