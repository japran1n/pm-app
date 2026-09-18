"use server";

// Team-side create/delete for `project_scope_documents` (20261106010000) —
// the Scope & Decisions portal page's "Add document" control (a document
// upload, or a link to one hosted elsewhere: a Figma proposal, a signed
// contract, etc).
//
// Two write paths, same split `deliverPortalDeliverable` vs. the rest of
// lib/actions/portal-deliverables.ts already follows in this codebase:
//   - `createScopeDocumentLink` is a plain JSON Server Action, wrapped in
//     `withAuthz` (lib/actions/authz.ts) like every other project-scoped
//     team mutation in lib/actions/project-site.ts.
//   - `uploadScopeDocument` takes a FormData (Server Actions only receive
//     `File` objects that way) and cannot go through `withAuthz`'s
//     JSON-schema pipeline, so it runs the same
//     auth-then-Storage-then-row shape `uploadAttachmentForUser`
//     (lib/attachments/upload.ts) and `deliverPortalDeliverable`
//     (lib/actions/portal-deliverables.ts) already use: Zod-validate the
//     non-file fields, resolve the caller, re-check membership + write
//     role + project visibility server-side, upload to Storage BEFORE the
//     row insert (so a failed row insert never orphans a Storage object —
//     same AS-114 rationale those two files document), then insert the
//     row.
//
// Bucket/path convention fixed by 20261106010000: bucket
// `scope-documents`, object path `{project_id}/{filename}` — mirrors
// task-attachments' own `{task_id}/{filename}` shape, adapted from task
// to project scope since this table has no task_id.
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { type ActionOutcome, type ActionResult, withAuthz } from "@/lib/actions/authz";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite, isClient } from "@/lib/auth/permissions";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  uploadAttachmentSchema,
} from "@/lib/validation/attachments";
import {
  createScopeDocumentLinkSchema,
  deleteScopeDocumentSchema,
  uploadScopeDocumentFieldsSchema,
} from "@/lib/validation/project-scope-documents";
import type { ScopeDocument } from "@/lib/queries/project-scope-documents";

const BUCKET = "scope-documents";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

const DOCUMENT_COLUMNS =
  "id, project_id, title, kind, file_path, url, uploaded_by, created_at";

function toScopeDocument(row: {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  file_path: string | null;
  url: string | null;
  uploaded_by: string;
  created_at: string;
}): ScopeDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    kind: row.kind as ScopeDocument["kind"],
    filePath: row.file_path,
    url: row.url,
    uploadedBy: row.uploaded_by,
    uploadedByName: null,
    createdAt: row.created_at,
  };
}

type ProjectExtra = { projectId: string; workspaceSlug: string };

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: ProjectExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  const workspace = data.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;

  if (!workspaceSlug) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: data.visibility === "private" ? "private" : "workspace",
    extra: { projectId: data.id, workspaceSlug },
  };
}

async function revalidateScopePage(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/portal/${workspaceSlug}/p/${projectId}/scope`, "page");
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}`, "layout");
  } catch (revalidateError) {
    logger.error("scope-documents: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

const AUTHZ_ERRORS = {
  membershipError: "You don't have permission to manage this project's scope.",
  writeError: "Viewers don't have permission to manage this project's scope.",
  visibilityError: "You don't have permission to manage this project's scope.",
};

export type ScopeDocumentActionResult = ActionResult<ScopeDocument>;

// ---------------------------------------------------------------------
// Link (createScopeDocumentLink)
// ---------------------------------------------------------------------

const createScopeDocumentLinkImpl = withAuthz(
  createScopeDocumentLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ScopeDocumentActionResult> => {
    const { data: inserted, error } = await ctx.admin
      .from("project_scope_documents")
      .insert({
        project_id: ctx.projectId,
        title: input.title,
        kind: "link",
        url: input.url,
        uploaded_by: ctx.user.id,
      })
      .select(DOCUMENT_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createScopeDocumentLink: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateScopePage(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toScopeDocument(inserted) };
  },
);

export async function createScopeDocumentLink(input: {
  projectId: string;
  title: string;
  url: string;
}): Promise<ScopeDocumentActionResult> {
  return createScopeDocumentLinkImpl(input);
}

// ---------------------------------------------------------------------
// Upload (uploadScopeDocument)
// ---------------------------------------------------------------------

// Takes a FormData with `projectId`, `title`, and `file` fields — Server
// Actions receive `File` objects through FormData, not plain arguments
// (same reason uploadAttachment/deliverPortalDeliverable do).
export async function uploadScopeDocument(
  formData: FormData,
): Promise<ScopeDocumentActionResult> {
  const projectIdRaw = formData.get("projectId");
  const titleRaw = formData.get("title");
  const file = formData.get("file");

  const parsedFields = uploadScopeDocumentFieldsSchema.safeParse({
    projectId: projectIdRaw,
    title: titleRaw,
  });

  if (!parsedFields.success) {
    return {
      ok: false,
      error: parsedFields.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  if (!(file instanceof File)) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to upload a file." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const projectExtra = await loadProjectExtra(admin, parsedFields.data.projectId);
  if (!projectExtra.ok) {
    return { ok: false, error: projectExtra.error };
  }

  // Defense in depth (same three-check shape uploadAttachmentForUser and
  // deliverPortalDeliverable both already use): active membership, write
  // role, project-visible-to-caller. RLS (20261106010000) is the real
  // enforcement boundary since the admin client below bypasses it.
  const membership = await requireActiveMembership(
    admin,
    projectExtra.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return { ok: false, error: AUTHZ_ERRORS.membershipError };
  }

  if (!canWrite({ role: membership.role })) {
    return { ok: false, error: AUTHZ_ERRORS.writeError };
  }

  if (
    !(await isProjectVisibleToCaller(
      admin,
      { projectId: projectExtra.projectId, visibility: projectExtra.visibility },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: AUTHZ_ERRORS.visibilityError };
  }

  const arrayBuffer = await file.arrayBuffer();

  // Reuses the same size/MIME allowlist as task attachments
  // (lib/validation/attachments.ts) — same "PDF, DOCX, or any of the
  // common office/image types" shape this feature's own spec asks for,
  // not a second, drifting allowlist.
  const parsedFile = uploadAttachmentSchema.safeParse({
    taskId: projectExtra.projectId, // reuses the schema's uuid-shaped id field; not a real task id
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

  // Re-run the real byte length against the same cap (same rationale as
  // uploadAttachmentForUser's identical check): a caller could declare a
  // small `fileSize` while submitting a larger buffer.
  if (arrayBuffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      error: `File must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    };
  }
  if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "This file type is not allowed." };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${projectExtra.projectId}/${uniqueSuffix}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    logger.error("uploadScopeDocument: storage upload failed", { error: uploadError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: inserted, error: insertError } = await admin
    .from("project_scope_documents")
    .insert({
      project_id: projectExtra.projectId,
      title: parsedFields.data.title,
      kind: "upload",
      file_path: objectPath,
      uploaded_by: user.id,
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (insertError || !inserted) {
    logger.error("uploadScopeDocument: row insert failed", { error: insertError });
    // Same "no orphaned Storage object survives a failed row insert"
    // cleanup uploadAttachmentForUser/deliverPortalDeliverable both do.
    await admin.storage.from(BUCKET).remove([objectPath]);
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateScopePage(projectExtra.extra.workspaceSlug, projectExtra.projectId);
  return { ok: true, data: toScopeDocument(inserted) };
}

// ---------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------

type DeleteExtra = ProjectExtra & {
  documentKind: string;
  documentFilePath: string | null;
};

async function loadDocumentExtra(
  admin: AdminClient,
  documentId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: DeleteExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_scope_documents")
    .select(
      "id, project_id, kind, file_path, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Document not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Document not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Document not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: {
      projectId: project.id,
      workspaceSlug,
      documentKind: data.kind,
      documentFilePath: data.file_path,
    },
  };
}

export type DeleteScopeDocumentResult = ActionResult<{ id: string }>;

const deleteScopeDocumentImpl = withAuthz(
  deleteScopeDocumentSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadDocumentExtra(admin, input.documentId),
  },
  async (input, ctx): Promise<DeleteScopeDocumentResult> => {
    // Row-first here (unlike upload's Storage-first ordering): deleting
    // the row first and leaving a Storage object briefly reachable only
    // through a path nothing references any more is the same acceptable
    // failure mode deleteAttachment's own doc comment prefers avoiding —
    // so mirror deleteAttachment exactly: Storage-first, row second. A
    // 'link' document has no Storage object at all, so this step is
    // skipped entirely for that kind.
    if (ctx.documentKind === "upload" && ctx.documentFilePath) {
      const { error: storageError } = await ctx.admin.storage
        .from(BUCKET)
        .remove([ctx.documentFilePath]);

      if (storageError) {
        logger.error("deleteScopeDocument: storage removal failed", { error: storageError });
        return { ok: false, error: GENERIC_ERROR };
      }
    }

    const { data: deleted, error } = await ctx.admin
      .from("project_scope_documents")
      .delete()
      .eq("id", input.documentId)
      .select("id")
      .maybeSingle();

    if (error || !deleted) {
      logger.error("deleteScopeDocument: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateScopePage(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: deleted.id } };
  },
);

export async function deleteScopeDocument(
  documentId: string,
): Promise<DeleteScopeDocumentResult> {
  return deleteScopeDocumentImpl({ documentId });
}

// ---------------------------------------------------------------------
// Signed URL for an 'upload'-kind document
// ---------------------------------------------------------------------

export type GetScopeDocumentSignedUrlResult = ActionOutcome<{ signedUrl: string }>;

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, same as getAttachmentSignedUrl

export async function getScopeDocumentSignedUrl(
  documentId: string,
): Promise<GetScopeDocumentSignedUrlResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: documentRow, error: documentError } = await admin
    .from("project_scope_documents")
    .select(
      "id, kind, file_path, project_id, projects(workspace_id, visibility, portal_enabled)",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (documentError || !documentRow || documentRow.kind !== "upload" || !documentRow.file_path) {
    return { ok: false, error: "Document not found." };
  }

  const project = documentRow.projects as
    | { workspace_id: string; visibility: string; portal_enabled: boolean }
    | { workspace_id: string; visibility: string; portal_enabled: boolean }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Document not found." };
  }

  const membership = await requireActiveMembership(admin, workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to view this file." };
  }

  if (isClient({ role: membership.role }) && !projectRow?.portal_enabled) {
    return { ok: false, error: "Document not found." };
  }

  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: documentRow.project_id,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: "Document not found." };
  }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(documentRow.file_path, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error("getScopeDocumentSignedUrl: signed URL generation failed", {
      error: signedUrlError,
    });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, signedUrl: signedUrlData.signedUrl };
}
