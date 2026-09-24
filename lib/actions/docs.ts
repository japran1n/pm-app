"use server";
import { logger } from "@/lib/observability/logger";


// Server Actions for the docs system (W2, docs/docs-system-plan.md).
//
// All mutations go through the plain RLS-respecting `createClient()`, after
// an application-level authorization step (`authorizeDocWrite`, below:
// active membership + team-writer role + project visibility — SEC-ACT3-07).
// RLS stays the second layer, and every UPDATE/DELETE checks that a row was
// actually affected so an RLS-filtered write never reports success.
//
// `revalidatePath` uses `/w` broadly (not a specific workspace slug) per
// this feature's Clarified implementation — the action layer doesn't know
// the caller's workspaceSlug, only its id, so revalidating the whole `/w`
// segment (layout-level) is the same "don't know the exact path, revalidate
// the shared root" convention used elsewhere in this codebase when a slug
// isn't in scope.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canTeamWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import {
  setDocClientVisibilitySchema,
  setDocKindSchema,
  type SetDocClientVisibilityInput,
  type SetDocKindInput,
} from "@/lib/validation/project-site";
import {
  revalidatePortalProject,
  extractWorkspaceSlug,
} from "@/lib/actions/portal-revalidate";
import type { ActionOutcome, ActionResult } from "@/lib/actions/authz";

function revalidateDocs() {
  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    // Non-fatal cache-freshness rationale, same convention as every other
    // action in this codebase (see lib/actions/tasks.ts's createTask etc.).
    logger.error("docs action: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

// F004c/F004d (AS-006): unlike revalidateDocs' broad `/w` fallback (this
// file's own documented reason: the action layer here never loads a
// workspaceSlug), the portal path DOES need the real slug + projectId, so
// this is a small extra lookup keyed off the doc's own row — one query,
// gated on the doc's CURRENT `client_visible` value by default. Callers that
// know the visibility flag just flipped FROM visible (e.g. unsharing a doc)
// must pass `force: true` so the portal still revalidates even though the
// doc's row now reads `client_visible: false` — otherwise the stale
// "still shared" version would keep serving from cache.
async function revalidatePortalForDoc(
  supabase: Awaited<ReturnType<typeof getCurrentUser>>["supabase"],
  docId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const { data: docRow, error } = await supabase
    .from("docs")
    .select("project_id, client_visible, projects(workspaces(slug))")
    .eq("id", docId)
    .maybeSingle();

  if (error || !docRow?.project_id || (!docRow.client_visible && !options.force)) {
    return;
  }

  const projects = docRow.projects as
    | { workspaces?: { slug: string } | { slug: string }[] | null }
    | { workspaces?: { slug: string } | { slug: string }[] | null }[]
    | null;
  const projectRow = Array.isArray(projects) ? projects[0] : projects;
  const slug = extractWorkspaceSlug(projectRow?.workspaces);
  if (slug) {
    revalidatePortalProject(slug, docRow.project_id);
  }
}

// ---------------------------------------------------------------------
// SEC-ACT3-07 (audit 2026-09-24): application-level authorization.
//
// Every action here used to rely on RLS alone, which had two gaps:
//   1. doc_links' policies gate on can_READ_workspace_docs, so a viewer
//      could insert links that the client portal renders as preview cards
//      (a phishing vector on a client-facing page);
//   2. an UPDATE/DELETE that RLS filtered to zero rows is not an error in
//      PostgREST, so a denied write reported success (ORG-MOD-07).
// Now each action resolves the target's workspace/project with the admin
// client, requires active membership + a team-writer role (owner/admin/
// member — same `canTeamWrite` default as withAuthz({ requireWrite })),
// requires project visibility for project-scoped docs, and still performs
// the write through the session client (RLS stays a second layer) while
// checking that a row was actually affected.
// ---------------------------------------------------------------------

type DocScope = { workspaceId: string; projectId: string | null };

type DocWriteContext = {
  supabase: Awaited<ReturnType<typeof getCurrentUser>>["supabase"];
  userId: string;
  role: WorkspaceRole;
  scope: DocScope;
};

const NOT_FOUND = "Document not found.";
const FOLDER_NOT_FOUND = "Folder not found.";
const NO_PERMISSION = "You don't have permission to edit documents.";
const GENERIC = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

async function loadDocScope(admin: AdminClient, docId: string): Promise<DocScope | null> {
  const { data } = await admin
    .from("docs")
    .select("workspace_id, project_id")
    .eq("id", docId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  return { workspaceId: data.workspace_id, projectId: data.project_id ?? null };
}

async function loadFolderScope(admin: AdminClient, folderId: string): Promise<DocScope | null> {
  const { data } = await admin
    .from("doc_folders")
    .select("workspace_id, project_id")
    .eq("id", folderId)
    .maybeSingle();
  if (!data) return null;
  return { workspaceId: data.workspace_id, projectId: data.project_id ?? null };
}

function sameScope(a: DocScope, b: DocScope): boolean {
  return a.workspaceId === b.workspaceId && (a.projectId ?? null) === (b.projectId ?? null);
}

// Resolves the caller and authorizes a docs write in `scope`. `resolve`
// runs with the admin client so "missing" and "forbidden" are decided
// before any session write is attempted.
async function authorizeDocWrite(
  resolve: (admin: AdminClient) => Promise<DocScope | null>,
  messages: { signedOut: string; notFound: string },
): Promise<{ ok: true; ctx: DocWriteContext; admin: AdminClient } | { ok: false; error: string }> {
  const { supabase, user } = await getCurrentUser();
  if (!user) return { ok: false, error: messages.signedOut };

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: caller identity verified via getCurrentUser() immediately above; membership/role/visibility are checked below before any write
  const admin = createAdminClient();
  const scope = await resolve(admin);
  if (!scope) return { ok: false, error: messages.notFound };

  const membership = await requireActiveMembership(admin, scope.workspaceId, user.id);
  if (!membership.ok) return { ok: false, error: messages.notFound };
  if (!canTeamWrite({ role: membership.role })) {
    return { ok: false, error: NO_PERMISSION };
  }

  if (scope.projectId) {
    const { data: project } = await admin
      .from("projects")
      .select("workspace_id, visibility")
      .eq("id", scope.projectId)
      .maybeSingle();
    if (!project || project.workspace_id !== scope.workspaceId) {
      return { ok: false, error: messages.notFound };
    }
    const visible = await isProjectVisibleToCaller(
      admin,
      {
        projectId: scope.projectId,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
      },
      user.id,
      membership.role,
    );
    if (!visible) return { ok: false, error: messages.notFound };
  }

  return {
    ok: true,
    admin,
    ctx: { supabase, userId: user.id, role: membership.role, scope },
  };
}

// A folder reference (parent / destination) must live in exactly the same
// workspace+project scope as the thing being placed in it.
async function folderMatchesScope(
  admin: AdminClient,
  folderId: string | null,
  scope: DocScope,
): Promise<boolean> {
  if (!folderId) return true;
  const folderScope = await loadFolderScope(admin, folderId);
  return !!folderScope && sameScope(folderScope, scope);
}

// ---------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------

export async function createDocFolder(
  workspaceId: string,
  name: string,
  parentId: string | null,
  projectId: string | null,
): Promise<{ id: string } | { error: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { error: "Folder name can't be empty." };
  }
  if (trimmedName.length > 200) {
    return { error: "Folder name must be 200 characters or fewer." };
  }

  const scope: DocScope = { workspaceId, projectId: projectId ?? null };
  const auth = await authorizeDocWrite(async () => scope, {
    signedOut: "You must be signed in to create a folder.",
    notFound: FOLDER_NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };
  const { supabase, userId } = auth.ctx;

  if (!(await folderMatchesScope(auth.admin, parentId, scope))) {
    return { error: FOLDER_NOT_FOUND };
  }

  const { data, error } = await supabase
    .from("doc_folders")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      parent_id: parentId,
      name: trimmedName,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createDocFolder: insert failed", { error: error });
    return { error: GENERIC };
  }

  revalidateDocs();

  return { id: data.id };
}

export async function renameDocFolder(
  folderId: string,
  name: string,
): Promise<{ error?: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { error: "Folder name can't be empty." };
  }
  if (trimmedName.length > 200) {
    return { error: "Folder name must be 200 characters or fewer." };
  }

  const auth = await authorizeDocWrite((admin) => loadFolderScope(admin, folderId), {
    signedOut: "You must be signed in to rename a folder.",
    notFound: FOLDER_NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };

  const { data, error } = await auth.ctx.supabase
    .from("doc_folders")
    .update({ name: trimmedName })
    .eq("id", folderId)
    .select("id");

  if (error) {
    logger.error("renameDocFolder: update failed", { error: error });
    return { error: GENERIC };
  }
  if (!data || data.length === 0) return { error: FOLDER_NOT_FOUND };

  revalidateDocs();

  return {};
}

// Deletes a folder. Sub-folders cascade-delete (ON DELETE CASCADE on
// `parent_id`, W1's migration); any doc that lived directly in this folder
// (or in a cascaded sub-folder) automatically gets `folder_id = null` via
// ON DELETE SET NULL — the plan's explicit "move to root, don't delete
// docs" rule falls out of the schema itself, nothing extra to do here.
export async function deleteDocFolder(
  folderId: string,
): Promise<{ error?: string }> {
  const auth = await authorizeDocWrite((admin) => loadFolderScope(admin, folderId), {
    signedOut: "You must be signed in to delete a folder.",
    notFound: FOLDER_NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };

  const { data, error } = await auth.ctx.supabase
    .from("doc_folders")
    .delete()
    .eq("id", folderId)
    .select("id");

  if (error) {
    logger.error("deleteDocFolder: delete failed", { error: error });
    return { error: GENERIC };
  }
  if (!data || data.length === 0) return { error: FOLDER_NOT_FOUND };

  revalidateDocs();

  return {};
}

// Moves a folder to a new parent. `newParentId = null` moves it to the
// scope's root. The `check_doc_folder_scope` trigger (W1's migration) is
// the last-line enforcement that the new parent shares this folder's
// (workspace_id, project_id); the same rule is checked up front here.
export async function moveDocFolder(
  folderId: string,
  newParentId: string | null,
): Promise<{ error?: string }> {
  if (newParentId === folderId) {
    return { error: "A folder can't be moved into itself." };
  }

  const auth = await authorizeDocWrite((admin) => loadFolderScope(admin, folderId), {
    signedOut: "You must be signed in to move a folder.",
    notFound: FOLDER_NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };

  if (!(await folderMatchesScope(auth.admin, newParentId, auth.ctx.scope))) {
    return { error: FOLDER_NOT_FOUND };
  }

  const { data, error } = await auth.ctx.supabase
    .from("doc_folders")
    .update({ parent_id: newParentId })
    .eq("id", folderId)
    .select("id");

  if (error) {
    logger.error("moveDocFolder: update failed", { error: error });
    // check_doc_folder_scope / doc_folders_no_self_ref last-line-of-defense
    // errors surface here too — mapped to the same generic message since
    // neither should be reachable through normal UI flows.
    return { error: GENERIC };
  }
  if (!data || data.length === 0) return { error: FOLDER_NOT_FOUND };

  revalidateDocs();

  return {};
}

// ---------------------------------------------------------------------
// Doc CRUD
// ---------------------------------------------------------------------

// Creates a brand-new empty doc (title="Untitled", content="") so the
// editor page (W4) always has a real row to load into — the caller
// navigates to the returned id immediately after this resolves.
export async function createDoc(
  workspaceId: string,
  folderId: string | null,
  projectId: string | null,
): Promise<{ id: string } | { error: string }> {
  const scope: DocScope = { workspaceId, projectId: projectId ?? null };
  const auth = await authorizeDocWrite(async () => scope, {
    signedOut: "You must be signed in to create a document.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };
  const { supabase, userId } = auth.ctx;

  if (!(await folderMatchesScope(auth.admin, folderId, scope))) {
    return { error: FOLDER_NOT_FOUND };
  }

  const { data, error } = await supabase
    .from("docs")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      folder_id: folderId,
      title: "Untitled",
      content: "",
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createDoc: insert failed", { error: error });
    return { error: GENERIC };
  }

  revalidateDocs();

  return { id: data.id };
}

// Saves the editor's title + content (auto-save, W4). `content` is written
// verbatim — a plain Markdown string, no serialization/escaping — per the
// plan's "clean Markdown storage" architecture decision.
//
// P2-2 (optimistic concurrency): when `lastKnownUpdatedAt` is provided the
// UPDATE includes `.eq("updated_at", lastKnownUpdatedAt)` so it only
// succeeds if no other session has written the doc since the caller last
// loaded it.  0 rows updated → `{ conflict: true }` (no silent overwrite).
// On success, `newUpdatedAt` carries the DB-assigned timestamp so the
// caller can refresh its own guard value for subsequent saves.
// When `lastKnownUpdatedAt` is omitted (backward-compatible callers) the
// concurrency guard is skipped, and 0 rows updated is an error.
const DOC_TITLE_MAX = 500;
const DOC_CONTENT_MAX = 1_000_000;

export async function updateDoc(
  docId: string,
  title: string,
  content: string,
  lastKnownUpdatedAt?: string,
): Promise<{ error?: string; conflict?: boolean; newUpdatedAt?: string }> {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) {
    return { error: "Title can't be empty." };
  }
  if (trimmedTitle.length > DOC_TITLE_MAX) {
    return { error: `Title must be ${DOC_TITLE_MAX} characters or fewer.` };
  }
  if (typeof content !== "string" || content.length > DOC_CONTENT_MAX) {
    return { error: "Document is too long." };
  }

  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, docId), {
    signedOut: "You must be signed in to save a document.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };
  const { supabase, userId } = auth.ctx;

  const baseQuery = supabase
    .from("docs")
    .update({
      title: trimmedTitle,
      content,
      updated_by: userId,
    })
    .eq("id", docId);

  // Conditionally add the optimistic-concurrency guard.
  const finalQuery =
    lastKnownUpdatedAt !== undefined
      ? baseQuery.eq("updated_at", lastKnownUpdatedAt)
      : baseQuery;

  const { data: updatedRows, error } = await finalQuery.select("updated_at");

  if (error) {
    logger.error("updateDoc: update failed", { error: error });
    return { error: GENERIC };
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Authorization already passed, so with the guard active this is a
    // concurrent save; without it, the write was blocked (ORG-MOD-07).
    if (lastKnownUpdatedAt !== undefined) return { conflict: true };
    return { error: NOT_FOUND };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, docId);

  const newUpdatedAt = (updatedRows[0] as { updated_at: string } | undefined)?.updated_at;
  return { newUpdatedAt };
}

export async function deleteDoc(docId: string): Promise<{ error?: string }> {
  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, docId), {
    signedOut: "You must be signed in to delete a document.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };
  const { supabase, userId } = auth.ctx;

  // F004c (AS-006): read client_visible + project BEFORE the delete — the
  // row (and its client_visible flag) won't exist to check afterward.
  const { data: docRowBeforeDelete } = await supabase
    .from("docs")
    .select("project_id, client_visible, projects(workspaces(slug))")
    .eq("id", docId)
    .maybeSingle();

  // P1-4: soft delete — matches the tasks/projects `deleted_at` convention
  // (20261127030000_docs_soft_delete.sql) instead of a permanent hard
  // DELETE, so an accidentally deleted doc is recoverable rather than gone
  // for good. `archived_by` mirrors `projects.archived_by` / `tasks.
  // deleted_by`: the acting user, set atomically in the same update.
  const { data: deletedRows, error } = await supabase
    .from("docs")
    .update({ deleted_at: new Date().toISOString(), archived_by: userId })
    .eq("id", docId)
    .select("id");

  if (error) {
    logger.error("deleteDoc: delete failed", { error: error });
    return { error: GENERIC };
  }
  if (!deletedRows || deletedRows.length === 0) return { error: NOT_FOUND };

  revalidateDocs();

  if (docRowBeforeDelete?.client_visible && docRowBeforeDelete.project_id) {
    const projects = docRowBeforeDelete.projects as
      | { workspaces?: { slug: string } | { slug: string }[] | null }
      | { workspaces?: { slug: string } | { slug: string }[] | null }[]
      | null;
    const projectRow = Array.isArray(projects) ? projects[0] : projects;
    const slug = extractWorkspaceSlug(projectRow?.workspaces);
    if (slug) {
      revalidatePortalProject(slug, docRowBeforeDelete.project_id);
    }
  }

  return {};
}

// Moves a doc to a different folder (or to root, when `newFolderId` is
// null). The destination folder must share the doc's workspace+project
// scope (docs have no check_doc_folder_scope-style trigger, so this
// app-level check is the only guard against filing a doc into another
// project's — or workspace's — tree).
export async function moveDoc(
  docId: string,
  newFolderId: string | null,
): Promise<{ error?: string }> {
  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, docId), {
    signedOut: "You must be signed in to move a document.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { error: auth.error };

  if (!(await folderMatchesScope(auth.admin, newFolderId, auth.ctx.scope))) {
    return { error: FOLDER_NOT_FOUND };
  }

  const { data, error } = await auth.ctx.supabase
    .from("docs")
    .update({ folder_id: newFolderId })
    .eq("id", docId)
    .select("id");

  if (error) {
    logger.error("moveDoc: update failed", { error: error });
    return { error: GENERIC };
  }
  if (!data || data.length === 0) return { error: NOT_FOUND };

  revalidateDocs();
  await revalidatePortalForDoc(auth.ctx.supabase, docId);

  return {};
}

// ---------------------------------------------------------------------
// F022 (missions/20260903-portal, AS-051): the doc header's client-share
// toggle and kind selector. Authorized by authorizeDocWrite like every
// other action in this file (SEC-ACT3-07), RLS as the second layer.
// ---------------------------------------------------------------------

export type SetDocClientVisibilityResult = ActionResult<{ docId: string; clientVisible: boolean }>;

export async function setDocClientVisibility(
  docId: string,
  visible: boolean,
): Promise<SetDocClientVisibilityResult> {
  const parsed = setDocClientVisibilitySchema.safeParse({
    docId,
    visible,
  } satisfies SetDocClientVisibilityInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, parsed.data.docId), {
    signedOut: "You must be signed in.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, userId, scope } = auth.ctx;

  // Only project docs can be shared with a client (the portal is
  // project-scoped; docs_select_client requires project_id).
  if (parsed.data.visible && !scope.projectId) {
    return { ok: false, error: "Only project documents can be shared with the client." };
  }

  // F004d (AS-006): read the PREVIOUS visibility before the write so we can
  // still revalidate the portal on unshare — after the update the row will
  // read `client_visible: false` and the lookup-based gate alone would skip
  // the revalidate entirely, leaving the portal serving a stale shared copy.
  const { data: previousRow } = await supabase
    .from("docs")
    .select("client_visible")
    .eq("id", parsed.data.docId)
    .maybeSingle();
  const wasVisible = previousRow?.client_visible === true;

  const { data: updatedRows, error } = await supabase
    .from("docs")
    .update({ client_visible: parsed.data.visible, updated_by: userId })
    .eq("id", parsed.data.docId)
    .select("id");

  if (error) {
    logger.error("setDocClientVisibility: update failed", { error });
    return { ok: false, error: GENERIC };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: NOT_FOUND };
  }

  // SEC-ACT1-09: sharing/unsharing with the client is security-relevant.
  if (wasVisible !== parsed.data.visible) {
    await writeAudit(supabase, {
      workspaceId: scope.workspaceId,
      action: parsed.data.visible ? "doc.client_shared" : "doc.client_unshared",
      targetType: "doc",
      targetId: parsed.data.docId,
      metadata: { projectId: scope.projectId },
    });
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId, {
    force: wasVisible || parsed.data.visible,
  });

  return { ok: true, data: { docId: parsed.data.docId, clientVisible: parsed.data.visible } };
}

export type SetDocKindResult = ActionResult<{ docId: string; kind: SetDocKindInput["kind"] }>;

export async function setDocKind(
  docId: string,
  kind: SetDocKindInput["kind"],
): Promise<SetDocKindResult> {
  const parsed = setDocKindSchema.safeParse({ docId, kind } satisfies SetDocKindInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, parsed.data.docId), {
    signedOut: "You must be signed in.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, userId } = auth.ctx;

  const { data: updatedRows, error } = await supabase
    .from("docs")
    .update({ doc_kind: parsed.data.kind, updated_by: userId })
    .eq("id", parsed.data.docId)
    .select("id");

  if (error) {
    logger.error("setDocKind: update failed", { error });
    return { ok: false, error: GENERIC };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: NOT_FOUND };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { docId: parsed.data.docId, kind: parsed.data.kind } };
}

// ---------------------------------------------------------------------
// F114 (client-portal-phase-2-plan.md, items E-H): "How we work" —
// when a doc becomes relevant, and its video/document link previews.
// Authorized by authorizeDocWrite (SEC-ACT3-07), like the rest of this file.
// ---------------------------------------------------------------------

import {
  addDocLinkSchema,
  setDocRelevantFromSchema,
  deleteDocLinkSchema,
  type AddDocLinkInput,
  type DeleteDocLinkInput,
  type SetDocRelevantFromInput,
} from "@/lib/validation/project-site";

export type SetDocRelevantFromResult = ActionResult<{ docId: string; relevantFrom: SetDocRelevantFromInput["relevantFrom"] }>;

// The app's "always" maps to the DB's `null` (docs_relevant_from_check)
// at this exact boundary — see relevantFromSchema's own comment for why
// this isn't modelled as `.nullable()` further up the stack.
export async function setDocRelevantFrom(
  docId: string,
  relevantFrom: SetDocRelevantFromInput["relevantFrom"],
): Promise<SetDocRelevantFromResult> {
  const parsed = setDocRelevantFromSchema.safeParse({
    docId,
    relevantFrom,
  } satisfies SetDocRelevantFromInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, parsed.data.docId), {
    signedOut: "You must be signed in.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, userId } = auth.ctx;

  const dbValue = parsed.data.relevantFrom === "always" ? null : parsed.data.relevantFrom;

  const { data: updatedRows, error } = await supabase
    .from("docs")
    .update({ relevant_from: dbValue, updated_by: userId })
    .eq("id", parsed.data.docId)
    .select("id");

  if (error) {
    logger.error("setDocRelevantFrom: update failed", { error });
    return { ok: false, error: GENERIC };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: NOT_FOUND };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { docId: parsed.data.docId, relevantFrom: parsed.data.relevantFrom } };
}

export type AddDocLinkResult = ActionResult<{ id: string }>;

export async function addDocLink(input: AddDocLinkInput): Promise<AddDocLinkResult> {
  const parsed = addDocLinkSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  // SEC-ACT3-07: doc_links are rendered as preview cards in the client
  // portal, so adding one is a team-writer action (viewers used to pass
  // the read-level RLS policy).
  const auth = await authorizeDocWrite((admin) => loadDocScope(admin, parsed.data.docId), {
    signedOut: "You must be signed in.",
    notFound: NOT_FOUND,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase } = auth.ctx;

  const { data, error } = await supabase
    .from("doc_links")
    .insert({
      doc_id: parsed.data.docId,
      url: parsed.data.url,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      thumbnail_url: parsed.data.thumbnailUrl ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("addDocLink: insert failed", { error });
    return { ok: false, error: GENERIC };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { id: data.id } };
}

export type DeleteDocLinkResult = ActionOutcome;

export async function deleteDocLink(linkId: string): Promise<DeleteDocLinkResult> {
  const parsed = deleteDocLinkSchema.safeParse({ linkId } satisfies DeleteDocLinkInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  let linkDocId: string | null = null;
  const auth = await authorizeDocWrite(
    async (admin) => {
      const { data: linkRow } = await admin
        .from("doc_links")
        .select("doc_id")
        .eq("id", parsed.data.linkId)
        .maybeSingle();
      if (!linkRow?.doc_id) return null;
      linkDocId = linkRow.doc_id;
      return loadDocScope(admin, linkRow.doc_id);
    },
    { signedOut: "You must be signed in.", notFound: "Link not found." },
  );
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase } = auth.ctx;

  const { data: deletedRows, error } = await supabase
    .from("doc_links")
    .delete()
    .eq("id", parsed.data.linkId)
    .select("id");

  if (error) {
    logger.error("deleteDocLink: delete failed", { error });
    return { ok: false, error: GENERIC };
  }
  if (!deletedRows || deletedRows.length === 0) {
    return { ok: false, error: "Link not found." };
  }

  revalidateDocs();
  if (linkDocId) {
    await revalidatePortalForDoc(supabase, linkDocId);
  }

  return { ok: true };
}
