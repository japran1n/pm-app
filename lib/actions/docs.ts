"use server";
import { logger } from "@/lib/observability/logger";


// Server Actions for the docs system (W2, docs/docs-system-plan.md).
//
// All mutations go through the plain RLS-respecting `createClient()` —
// `doc_folders`/`docs`' own RLS policies (`is_active_workspace_member`,
// W1's migration) are the enforcement boundary for both read and write,
// same "any active workspace member may edit" model the plan's Arhitekturne
// odluke section calls out (no per-doc ownership or role gating in v1).
// Every action still independently checks `auth.getUser()` first so an
// unauthenticated caller gets a clean error rather than falling through to
// an RLS rejection with an opaque Postgres error.
//
// `revalidatePath` uses `/w` broadly (not a specific workspace slug) per
// this feature's Clarified implementation — the action layer doesn't know
// the caller's workspaceSlug, only its id, so revalidating the whole `/w`
// segment (layout-level) is the same "don't know the exact path, revalidate
// the shared root" convention used elsewhere in this codebase when a slug
// isn't in scope.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
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

function revalidateDocs() {
  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    // Non-fatal cache-freshness rationale, same convention as every other
    // action in this codebase (see lib/actions/tasks.ts's createTask etc.).
    logger.error("docs action: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

// F004c (AS-006): unlike revalidateDocs' broad `/w` fallback (this file's
// own documented reason: the action layer here never loads a
// workspaceSlug), the portal path DOES need the real slug + projectId, so
// this is a small extra lookup keyed off the doc's own row — one query,
// gated on the doc's CURRENT `client_visible` value (checked AFTER the
// write, so this also correctly fires when a share toggle just turned
// visibility off, not only on).
async function revalidatePortalForDoc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  docId: string,
): Promise<void> {
  const { data: docRow, error } = await supabase
    .from("docs")
    .select("project_id, client_visible, projects(workspaces(slug))")
    .eq("id", docId)
    .maybeSingle();

  if (error || !docRow?.client_visible || !docRow.project_id) {
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

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
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

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to create a folder." };
  }

  const { data, error } = await supabase
    .from("doc_folders")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      parent_id: parentId,
      name: trimmedName,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createDocFolder: insert failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
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

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to rename a folder." };
  }

  const { error } = await supabase
    .from("doc_folders")
    .update({ name: trimmedName })
    .eq("id", folderId);

  if (error) {
    logger.error("renameDocFolder: update failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

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
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to delete a folder." };
  }

  const { error } = await supabase
    .from("doc_folders")
    .delete()
    .eq("id", folderId);

  if (error) {
    logger.error("deleteDocFolder: delete failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();

  return {};
}

// Moves a folder to a new parent. `newParentId = null` moves it to the
// scope's root. The `check_doc_folder_scope` trigger (W1's migration) is
// the actual enforcement that the new parent shares this folder's
// (workspace_id, project_id) — a mismatched scope raises a Postgres
// exception here rather than silently moving the folder into a different
// project's tree.
export async function moveDocFolder(
  folderId: string,
  newParentId: string | null,
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to move a folder." };
  }

  if (newParentId === folderId) {
    return { error: "A folder can't be moved into itself." };
  }

  const { error } = await supabase
    .from("doc_folders")
    .update({ parent_id: newParentId })
    .eq("id", folderId);

  if (error) {
    logger.error("moveDocFolder: update failed", { error: error });
    // check_doc_folder_scope / doc_folders_no_self_ref last-line-of-defense
    // errors surface here too — mapped to the same generic message since
    // neither should be reachable through normal UI flows.
    return { error: "Something went wrong. Please try again in a moment." };
  }

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
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to create a document." };
  }

  const { data, error } = await supabase
    .from("docs")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      folder_id: folderId,
      title: "Untitled",
      content: "",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createDoc: insert failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();

  return { id: data.id };
}

// Saves the editor's title + content (auto-save, W4). `content` is written
// verbatim — a plain Markdown string, no serialization/escaping — per the
// plan's "clean Markdown storage" architecture decision.
export async function updateDoc(
  docId: string,
  title: string,
  content: string,
): Promise<{ error?: string }> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { error: "Title can't be empty." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to save a document." };
  }

  const { error } = await supabase
    .from("docs")
    .update({
      title: trimmedTitle,
      content,
      updated_by: user.id,
    })
    .eq("id", docId);

  if (error) {
    logger.error("updateDoc: update failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, docId);

  return {};
}

export async function deleteDoc(docId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to delete a document." };
  }

  // F004c (AS-006): read client_visible + project BEFORE the delete — the
  // row (and its client_visible flag) won't exist to check afterward.
  const { data: docRowBeforeDelete } = await supabase
    .from("docs")
    .select("project_id, client_visible, projects(workspaces(slug))")
    .eq("id", docId)
    .maybeSingle();

  const { error } = await supabase.from("docs").delete().eq("id", docId);

  if (error) {
    logger.error("deleteDoc: delete failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

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
// null). No cross-scope validation is needed here beyond what RLS already
// enforces (workspace membership) — unlike folders, a doc has no
// `check_doc_folder_scope`-style trigger, so the write is a plain column
// update.
export async function moveDoc(
  docId: string,
  newFolderId: string | null,
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to move a document." };
  }

  const { error } = await supabase
    .from("docs")
    .update({ folder_id: newFolderId })
    .eq("id", docId);

  if (error) {
    logger.error("moveDoc: update failed", { error: error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, docId);

  return {};
}

// ---------------------------------------------------------------------
// F022 (missions/20260903-portal, AS-051): the doc header's client-share
// toggle and kind selector, same "any active workspace member may edit"
// RLS-as-enforcement-boundary posture as every other action in this file
// — `docs_update_active_members` (20260905030000, unchanged by this
// feature) already excludes `viewer`/`client` roles and non-visible
// projects; this action adds no extra authorization layer on top of it,
// matching updateDoc's own convention exactly.
// ---------------------------------------------------------------------

export type SetDocClientVisibilityResult =
  | { ok: true; data: { docId: string; clientVisible: boolean } }
  | { ok: false; error: string };

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

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("docs")
    .update({ client_visible: parsed.data.visible, updated_by: user.id })
    .eq("id", parsed.data.docId);

  if (error) {
    logger.error("setDocClientVisibility: update failed", { error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { docId: parsed.data.docId, clientVisible: parsed.data.visible } };
}

export type SetDocKindResult =
  | { ok: true; data: { docId: string; kind: SetDocKindInput["kind"] } }
  | { ok: false; error: string };

export async function setDocKind(
  docId: string,
  kind: SetDocKindInput["kind"],
): Promise<SetDocKindResult> {
  const parsed = setDocKindSchema.safeParse({ docId, kind } satisfies SetDocKindInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("docs")
    .update({ doc_kind: parsed.data.kind, updated_by: user.id })
    .eq("id", parsed.data.docId);

  if (error) {
    logger.error("setDocKind: update failed", { error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { docId: parsed.data.docId, kind: parsed.data.kind } };
}

// ---------------------------------------------------------------------
// F114 (client-portal-phase-2-plan.md, items E-H): "How we work" —
// when a doc becomes relevant, and its video/document link previews.
// Same "any active workspace member may edit" RLS-as-enforcement-
// boundary posture as setDocKind/setDocClientVisibility above.
// ---------------------------------------------------------------------

import {
  addDocLinkSchema,
  setDocRelevantFromSchema,
  deleteDocLinkSchema,
  type AddDocLinkInput,
  type DeleteDocLinkInput,
  type SetDocRelevantFromInput,
} from "@/lib/validation/project-site";

export type SetDocRelevantFromResult =
  | { ok: true; data: { docId: string; relevantFrom: SetDocRelevantFromInput["relevantFrom"] } }
  | { ok: false; error: string };

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

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const dbValue = parsed.data.relevantFrom === "always" ? null : parsed.data.relevantFrom;

  const { error } = await supabase
    .from("docs")
    .update({ relevant_from: dbValue, updated_by: user.id })
    .eq("id", parsed.data.docId);

  if (error) {
    logger.error("setDocRelevantFrom: update failed", { error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { docId: parsed.data.docId, relevantFrom: parsed.data.relevantFrom } };
}

export type AddDocLinkResult = { ok: true; data: { id: string } } | { ok: false; error: string };

export async function addDocLink(input: AddDocLinkInput): Promise<AddDocLinkResult> {
  const parsed = addDocLinkSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

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
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  await revalidatePortalForDoc(supabase, parsed.data.docId);

  return { ok: true, data: { id: data.id } };
}

export type DeleteDocLinkResult = { ok: true } | { ok: false; error: string };

export async function deleteDocLink(linkId: string): Promise<DeleteDocLinkResult> {
  const parsed = deleteDocLinkSchema.safeParse({ linkId } satisfies DeleteDocLinkInput);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // F004c (AS-006): capture the owning doc id before delete so it can
  // still be resolved for the portal-revalidate check afterward.
  const { data: linkRow } = await supabase
    .from("doc_links")
    .select("doc_id")
    .eq("id", parsed.data.linkId)
    .maybeSingle();

  const { error } = await supabase.from("doc_links").delete().eq("id", parsed.data.linkId);

  if (error) {
    logger.error("deleteDocLink: delete failed", { error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateDocs();
  if (linkRow?.doc_id) {
    await revalidatePortalForDoc(supabase, linkRow.doc_id);
  }

  return { ok: true };
}
