import { logger } from "@/lib/observability/logger";

// Plain (non-"use server") module holding the shared attachment-upload
// implementation. This file MUST NOT carry a "use server" directive: every
// exported async function inside a "use server" module is auto-registered
// as a client-invocable Server Action endpoint, reachable by any caller who
// can reach the app regardless of whether any UI ever calls it — that is
// exactly the bug fixed here (M17 scrutiny BLOCKER-3). By living in a plain
// module, `uploadAttachmentForUser` is only reachable via a real import, not
// a network-addressable action ID.
//
// Callers:
//   - lib/actions/attachments.ts's `uploadAttachment` Server Action, which
//     resolves `userId` itself from the caller's authenticated cookie
//     session (never accepts it as an argument from outside this module).
//   - app/api/extension/attachments/route.ts, which resolves `userId`
//     itself from a verified bearer JWT before calling this function
//     directly (bypassing the Server Action layer entirely, since a Route
//     Handler is already not client-invocable-by-ID the way a Server Action
//     is).
//   - tests/integration/*.test.ts, which import this module directly (never
//     through lib/actions/attachments.ts) to exercise the underlying logic,
//     including the test-only `objectPathOverride` seam below.
//
// Nothing in this module's exported signature should ever be re-exported,
// wrapped, or aliased from a "use server" file with the same parameter
// shape (a raw, trusted `userId` argument) — doing so reopens BLOCKER-3.
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { uploadAttachmentSchema } from "@/lib/validation/attachments";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";

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
        mimeType: string | null;
      };
    }
  | { ok: false; error: string };

// F065/F294: the shared upload code path. `userId` here MUST already be a
// verified identity resolved by the caller from a real session/JWT — this
// function performs no identity verification of its own, by design, so it
// must never be reachable from a context where `userId` could be an
// unverified, caller-supplied value (that is the whole point of moving it
// out of the "use server" module — see this file's header comment).
//
// `options.objectPathOverride` is a test-only injection point (see
// tests/integration/extension-attachments.test.ts's AS-567 case) used to
// force a deterministic real Storage-layer conflict (two uploads racing for
// the exact same object path) so the "no orphaned row survives a failed
// upload" invariant can be proven against the real Supabase Storage API
// rather than asserted from reading the code. No production caller passes
// this — every real call lets the function generate its own random suffix,
// exactly as before this feature. Because this module carries no "use
// server" directive, this parameter is not reachable through any Server
// Action endpoint — only through a direct import, which only test code (and
// this module's own two production callers, which never pass it) performs.
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

  // Defense in depth beyond Zod: `parsed.data.fileSize` above only proves
  // the client-DECLARED size is within the cap — it says nothing about the
  // REAL byte length of the buffer that is actually about to be uploaded. A
  // caller could otherwise declare a small `fileSize` while submitting a
  // much larger `arrayBuffer`, evading the 10MB cap entirely (M17 scrutiny
  // BLOCKER-3). Re-run the same size check against the real byte length,
  // independent of whatever the caller claimed.
  const realSizeParsed = uploadAttachmentSchema.shape.fileSize.safeParse(
    input.arrayBuffer.byteLength,
  );
  if (!realSizeParsed.success) {
    return {
      ok: false,
      error: realSizeParsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace so membership is checked
  // against the real workspace, never one supplied (or omitted) by the
  // client. Only non-deleted tasks are eligible, same convention as
  // addComment.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, deleted_at, projects(workspace_id, visibility)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string; visibility: string }
    | { workspace_id: string; visibility: string }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

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

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223).
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to upload files.",
    };
  }

  // F323 (AS-227, AS-228, AS-229): the caller must be able to SEE this
  // task's project themselves, not just be an active workspace member —
  // see isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts. Same generic message as the role
  // failure above so a private project's existence is never disclosed.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: taskRow.project_id,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      userId,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "Viewers don't have permission to upload files.",
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
    logger.error("uploadAttachment: storage upload failed", { error: uploadError });
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
      mime_type: parsed.data.mimeType,
    })
    .select("id, task_id, file_url, file_name, uploaded_by, created_at, mime_type")
    .single();

  if (insertError || !inserted) {
    logger.error("uploadAttachment: row insert failed", { error: insertError });
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
    logger.error("uploadAttachment: signed URL generation failed", { error: signedUrlError });
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
      logger.error("uploadAttachment: revalidatePath failed (non-fatal)", { error: revalidateError });
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
      mimeType: inserted.mime_type,
    },
  };
}
