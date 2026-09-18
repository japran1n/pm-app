"use server";

// F014 (missions/20260903-portal, AS-029, AS-030): the portal's own
// "upload" action for a `client_deliverables` row — Your list view's
// upload control calls this, never `lib/actions/attachments.ts`'s
// `uploadAttachment` directly.
//
// Why not reuse `uploadAttachment` as-is (the spec's own "reuse the
// existing storage bucket and policies" instruction is about the BUCKET
// and PATH CONVENTION, not that one Server Action): `uploadAttachmentForUser`
// (lib/attachments/upload.ts) gates on `canWrite`, and `canWrite` is
// `ctx.role !== "viewer" && !isClient(ctx)` (lib/auth/permissions.ts,
// "client ... is read-only across every predicate in this module") — a
// portal client is unconditionally rejected by that check. This action
// reuses the SAME bucket (`task-attachments`) and the SAME object-path
// convention (`{task_id}/{filename}`, F064's own fixed shape) via the
// admin client, but authorizes the caller itself (active member +
// project-visible + portal-enabled — the same three checks
// `getAttachmentSignedUrl` already applies for a client read path) rather
// than `canWrite`.
//
// The deliverable's own state transition is a SEPARATE call into
// `mark_deliverable_delivered_atomic` (20260928010000): a SECURITY
// DEFINER RPC that hardcodes `state = 'delivered'` and takes no
// state/decision argument at all — see that migration's header comment
// for why THAT function, not this Server Action's own input validation,
// is the actual enforcement of "a client cannot set a deliverable to
// accepted through any path, including calling this action directly".
// Called after the Storage/attachments write succeeds (Storage-first,
// same ordering rationale `deleteAttachment`'s own doc comment in
// lib/actions/attachments.ts documents for its own two-step operation):
// if the RPC step fails, the file is not orphaned — it is a real,
// visible attachment on the deliverable's task, and the deliverable's
// state is simply unchanged (the client sees the same "waiting for us to
// check it" outstanding row either way, since nothing moved to
// 'delivered' at all until the RPC does).
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  uploadAttachmentSchema,
} from "@/lib/validation/attachments";
import { deliverPortalDeliverableSchema } from "@/lib/validation/portal-deliverables";
import type { DeliverableState } from "@/lib/queries/deliverables";
import { assertNotPreview } from "@/lib/auth/assert-not-preview";
import { createNotification } from "@/lib/notifications/create-notification";
import { getPortalEventRecipients } from "@/lib/notifications/portal-recipients";
import type { ActionResult } from "@/lib/actions/authz";

const ATTACHMENTS_BUCKET = "task-attachments";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type DeliverPortalDeliverableResult = ActionResult<{ id: string; state: DeliverableState }>;

// Takes a FormData for the same reason `uploadAttachment` does — Server
// Actions receive `File` objects through FormData, not plain arguments.
// Expects `deliverableId` and `file` fields.
export async function deliverPortalDeliverable(
  formData: FormData,
): Promise<DeliverPortalDeliverableResult> {
  // F024b (AS-052): default-deny -- the storage upload and the
  // mark_deliverable_delivered_atomic RPC below both go through the
  // admin/session clients regardless of caller, so this guard is the
  // only thing stopping a previewing admin from delivering as the client.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

  const deliverableIdRaw = formData.get("deliverableId");
  const file = formData.get("file");

  const parsedId = deliverPortalDeliverableSchema.safeParse({
    deliverableId: deliverableIdRaw,
  });

  if (!parsedId.success) {
    return {
      ok: false,
      error: parsedId.error.issues[0]?.message ?? "Invalid deliverable.",
    };
  }

  if (!(file instanceof File)) {
    return { ok: false, error: "Choose a file to send." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to send a file." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: deliverableRow, error: deliverableError } = await admin
    .from("client_deliverables")
    .select(
      "id, task_id, state, tasks(id, deleted_at, project_id, projects(workspace_id, visibility, portal_enabled))",
    )
    .eq("id", parsedId.data.deliverableId)
    .maybeSingle();

  if (deliverableError || !deliverableRow) {
    return { ok: false, error: "Deliverable not found." };
  }

  if (deliverableRow.state === "accepted" || deliverableRow.state === "waived") {
    return { ok: false, error: "This item has already been accepted." };
  }

  if (!deliverableRow.task_id) {
    return {
      ok: false,
      error: "This item has no linked task to attach a file to yet. Ask the team to link one.",
    };
  }

  const task = deliverableRow.tasks as
    | {
        id: string;
        deleted_at: string | null;
        project_id: string;
        projects:
          | { workspace_id: string; visibility: string; portal_enabled: boolean }
          | { workspace_id: string; visibility: string; portal_enabled: boolean }[]
          | null;
      }
    | {
        id: string;
        deleted_at: string | null;
        project_id: string;
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
    return { ok: false, error: "Deliverable not found." };
  }

  // Defense in depth (mirrors getAttachmentSignedUrl's own three-check
  // shape): active membership, portal enabled, project visible to this
  // caller. The RPC below re-checks all of this independently as the
  // real enforcement boundary (it is SECURITY DEFINER and bypasses RLS),
  // this is the same "second line, not the only line" convention every
  // action in this codebase follows.
  const membership = await requireActiveMembership(admin, workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to send this file." };
  }

  if (!projectRow?.portal_enabled) {
    return { ok: false, error: "Deliverable not found." };
  }

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
    return { ok: false, error: "Deliverable not found." };
  }

  const arrayBuffer = await file.arrayBuffer();

  const parsedFile = uploadAttachmentSchema.safeParse({
    taskId: taskRow.id,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  });

  if (!parsedFile.success) {
    return {
      ok: false,
      error: parsedFile.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  // Re-run the real byte length against the same cap (see
  // uploadAttachmentForUser's identical comment): a caller could declare
  // a small `fileSize` while submitting a larger buffer.
  const realSizeParsed = uploadAttachmentSchema.shape.fileSize.safeParse(
    arrayBuffer.byteLength,
  );
  if (!realSizeParsed.success) {
    return {
      ok: false,
      error: realSizeParsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "This file type is not allowed." };
  }
  if (arrayBuffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      error: `File must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = parsedFile.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${taskRow.id}/${uniqueSuffix}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: parsedFile.data.mimeType,
      upsert: false,
    });

  if (uploadError) {
    logger.error("deliverPortalDeliverable: storage upload failed", { error: uploadError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { error: insertError } = await admin.from("attachments").insert({
    task_id: taskRow.id,
    file_url: objectPath,
    file_name: parsedFile.data.fileName,
    uploaded_by: user.id,
    mime_type: parsedFile.data.mimeType,
  });

  if (insertError) {
    logger.error("deliverPortalDeliverable: attachment row insert failed", { error: insertError });
    // Same "no orphaned Storage object survives a failed row insert"
    // cleanup deleteAttachment/uploadAttachmentForUser both already do.
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([objectPath]);
    return { ok: false, error: GENERIC_ERROR };
  }

  // The file is safely stored and referenced at this point. Only now flip
  // the deliverable's own state — via the session-bound client, since
  // `mark_deliverable_delivered_atomic` is SECURITY DEFINER and does its
  // own `auth.uid()`-based authorization internally (same
  // session-vs-admin client rule `decideDeliverable` follows for
  // `accept_deliverable_atomic`).
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "mark_deliverable_delivered_atomic",
    { p_deliverable_id: parsedId.data.deliverableId },
  );

  if (rpcError || !rpcData) {
    logger.error("deliverPortalDeliverable: mark_deliverable_delivered_atomic failed", {
      error: rpcError,
    });
    return { ok: false, error: GENERIC_ERROR };
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    logger.error("deliverPortalDeliverable: rpc returned no row");
    return { ok: false, error: GENERIC_ERROR };
  }

  // F084 (AS-2): a delivered file had no signal to the team beyond
  // remembering to check the queue. Best-effort/non-fatal, same reasoning
  // as every other post-write side effect in this file (the Storage
  // upload and the RPC have already succeeded above).
  try {
    const recipients = await getPortalEventRecipients(admin, {
      projectId: taskRow.project_id,
      taskId: taskRow.id,
      excludeUserId: user.id,
    });

    for (const recipientId of recipients) {
      await createNotification(
        supabase,
        {
          userId: recipientId,
          workspaceId,
          kind: "client_deliverable_submitted",
          taskId: taskRow.id,
          payload: { deliverableId: parsedId.data.deliverableId },
        },
        "deliverPortalDeliverable",
      );
    }
  } catch (notifyError) {
    logger.error("deliverPortalDeliverable: notify failed (non-fatal)", { error: notifyError });
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      // F013 (AS-017): "your-list" is a dead redirect-only route as of
      // F009 -- the live materials surface is "for-you".
      revalidatePath(`/portal/${workspaceRow.slug}/p/${taskRow.project_id}/for-you`, "page");
      revalidatePath(`/portal/${workspaceRow.slug}/p/${taskRow.project_id}`, "layout");
    } catch (revalidateError) {
      logger.error("deliverPortalDeliverable: revalidatePath failed (non-fatal)", {
        error: revalidateError,
      });
    }
  }

  return {
    ok: true,
    data: { id: parsedId.data.deliverableId, state: row.state as DeliverableState },
  };
}
