"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteAttachmentSchema,
  getAttachmentSignedUrlSchema,
} from "@/lib/validation/attachments";
import { logger } from "@/lib/observability/logger";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";
import { canWrite, isClient, type WorkspaceRole } from "@/lib/auth/permissions";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import {
  uploadAttachmentForUser,
  type UploadAttachmentResult,
} from "@/lib/attachments/upload";

// Re-exported so existing callers of `UploadAttachmentResult` from this
// module keep working unchanged.
export type { UploadAttachmentResult };

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
//
// SECURITY (M17 scrutiny BLOCKER-3, F334): this is the ONLY exported
// function in this "use server" module that touches the shared upload
// implementation, and it is deliberately the ONLY one — every exported
// async function in a "use server" module is a client-invocable Server
// Action endpoint reachable by ID regardless of whether any UI calls it.
// The actual upload logic (including a raw, trusted `userId` parameter)
// now lives in lib/attachments/upload.ts, a plain module with no "use
// server" directive, so it is only reachable via a real import — never a
// network-addressable action. `userId` below is resolved from the
// caller's own authenticated cookie session, never accepted as an
// argument, so this Server Action can never be used to act as another
// user.
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
    .select(
      "id, file_url, tasks(project_id, deleted_at, client_visible, projects(workspace_id, visibility, portal_enabled))",
    )
    .eq("id", attachmentId)
    .maybeSingle();

  if (attachmentError || !attachmentRow) {
    return { ok: false, error: "Attachment not found." };
  }

  const task = attachmentRow.tasks as
    | {
        project_id: string;
        deleted_at: string | null;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; portal_enabled: boolean }
          | { workspace_id: string; visibility: string; portal_enabled: boolean }[]
          | null;
      }
    | {
        project_id: string;
        deleted_at: string | null;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; portal_enabled: boolean }
          | { workspace_id: string; visibility: string; portal_enabled: boolean }[]
          | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

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

  // F3 (docs/client-dashboard-features-plan.md): isProjectVisibleToCaller
  // below only re-implements *project*-level visibility (workspace vs
  // private) — it has no notion of the client role's stricter, per-task
  // `client_visible` rule, because none of its other callers (team-only
  // actions) need one. A client whose project is 'workspace'-visible (the
  // default) would otherwise be able to mint a signed URL for ANY
  // attachment on ANY task in that project by guessing/enumerating
  // attachment ids, not just ones the team actually shared. Same "not
  // found", not "forbidden" — whether an internal attachment exists is not
  // a client's business.
  if (isClient({ role: membership.role }) && !taskRow.client_visible) {
    return { ok: false, error: "Attachment not found." };
  }

  // F006l/B4: the signed URL below is minted with `admin.storage`, so the
  // gated `attachments_objects_select_active_members` storage policy
  // (which folds in `is_project_portal_enabled` via `is_task_visible_to`)
  // never runs for this path. Without this explicit check, a client of a
  // portal-disabled project holding a `client_visible` attachment id could
  // still mint a working download URL (F006l/M1-scrutiny-3 B4).
  if (isClient({ role: membership.role }) && !projectRow?.portal_enabled) {
    return { ok: false, error: "Attachment not found." };
  }

  // F323 (AS-227, AS-228, AS-229): read-path confidentiality — the caller
  // must be able to SEE this attachment's task's project themselves, not
  // just be an active workspace member. Returns the SAME "Attachment not
  // found" message this function already uses for a genuinely missing
  // attachment (never a permission-denied message), so a read-path leak
  // never even confirms the attachment exists.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: taskRow.project_id,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: "Attachment not found." };
  }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachmentRow.file_url, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error("getAttachmentSignedUrl: signed URL generation failed", { error: signedUrlError });
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
    .select(
      "id, file_url, uploaded_by, tasks(project_id, deleted_at, projects(workspace_id, visibility))",
    )
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (attachmentError || !attachmentRow) {
    return { ok: false, error: "Attachment not found." };
  }

  const task = attachmentRow.tasks as
    | {
        project_id: string;
        deleted_at: string | null;
        projects:
          | { workspace_id: string; visibility: string }
          | { workspace_id: string; visibility: string }[]
          | null;
      }
    | {
        project_id: string;
        deleted_at: string | null;
        projects:
          | { workspace_id: string; visibility: string }
          | { workspace_id: string; visibility: string }[]
          | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!taskRow || !workspaceId) {
    return { ok: false, error: "Attachment not found." };
  }

  const isUploader = attachmentRow.uploaded_by === user.id;

  // AS-110: the uploader may always delete their own attachment. AS-111:
  // anyone else needs to be an admin/owner of the workspace.
  let deleteCallerRole: WorkspaceRole;
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
    deleteCallerRole = adminMembership.role;
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
    // F128 (AS-216, AS-217): even the uploader must currently be a
    // writable role — same "demoted since uploading" defense-in-depth as
    // deleteComment's author branch.
    if (!canWrite({ role: membership.role })) {
      return {
        ok: false,
        error: "Viewers don't have permission to delete attachments.",
      };
    }
    deleteCallerRole = membership.role;
  }

  // F323 (AS-227, AS-228, AS-229): the caller (uploader or admin) must be
  // able to SEE this attachment's task's project themselves, not just be
  // an active workspace member. Same generic message this function
  // already returns for a permission failure, so a private project's
  // existence is never disclosed.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: taskRow.project_id,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      deleteCallerRole,
    ))
  ) {
    return {
      ok: false,
      error: "You don't have permission to delete this attachment.",
    };
  }

  // Storage-first (see the AS-114 rationale in this function's doc
  // comment above). A failure here aborts before the row is touched, so
  // at worst the row still points at a file that still exists.
  const { error: storageError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachmentRow.file_url]);

  if (storageError) {
    logger.error("deleteAttachment: storage removal failed", { error: storageError });
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
    logger.error("deleteAttachment: row delete failed after storage removal succeeded " +
        `(attachment ${parsed.data.attachmentId}, path ${attachmentRow.file_url}):`, { error: deleteError });
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
      logger.error("deleteAttachment: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return { ok: true, data: { id: deleted.id } };
}
