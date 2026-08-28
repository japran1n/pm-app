// Data-fetching for the docs system (W2, docs/docs-system-plan.md).
//
// Both tables (`doc_folders`, `docs` — W1's migration,
// supabase/migrations/20260904010000_docs_system.sql) are RLS-scoped to
// active workspace members via `is_active_workspace_member(workspace_id)`,
// so the plain RLS-respecting `createClient()` is sufficient here — no
// admin client, no manual membership re-check needed for these read-only
// queries (mirrors every other read-only query file in lib/queries/ that
// relies on RLS as the enforcement boundary, e.g. getWorkspaceProjects in
// lib/queries/projects.ts).
//
// `projectId: null` means workspace-level scope; a non-null `projectId`
// scopes to that project's own docs/folders. Callers pass the same value
// through unchanged (workspace docs page passes null, project docs page
// passes the project's id) — this file never has to guess the scope.

import { createClient } from "@/lib/supabase/server";

export type DocFolder = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  position: number;
  createdBy: string;
  createdAt: string;
};

export type Doc = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  folderId: string | null;
  title: string;
  content: string;
  position: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapFolderRow(row: {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  position: number;
  created_by: string;
  created_at: string;
}): DocFolder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapDocRow(row: {
  id: string;
  workspace_id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  content: string;
  position: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}): Doc {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    position: row.position,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Base (unscoped) query builders for the two tables this file reads from,
// factored out so their types can be named below -- `createClient()`
// (lib/supabase/server.ts) doesn't thread the generated `Database` type
// through `createServerClient`, so TypeScript infers these as concrete
// (if loosely-typed) `PostgrestFilterBuilder` instantiations rather than
// `any`; naming them via `ReturnType` keeps applyScope itself free of
// `any` without hand-writing that generic's 8 type parameters.
function docFoldersBaseQuery(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase.from("doc_folders").select(
    "id, workspace_id, project_id, parent_id, name, position, created_by, created_at",
  );
}

function docsBaseQuery(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase.from("docs").select(
    "id, workspace_id, project_id, folder_id, title, content, position, created_by, updated_by, created_at, updated_at",
  );
}

type FolderQuery = ReturnType<typeof docFoldersBaseQuery>;
type DocsQuery = ReturnType<typeof docsBaseQuery>;

// Applies the (workspaceId, projectId) scope filter shared by every query
// in this file. `.is("project_id", null)` for workspace scope,
// `.eq("project_id", projectId)` for project scope — never a loose
// `.eq("project_id", projectId ?? null)` (`.eq` with a null value does not
// behave like `.is`). Overloaded (rather than made generic) because a
// fully generic signature here forces TypeScript to structurally compare
// the two tables' `PostgrestFilterBuilder` instantiations against each
// other, which blows the compiler's instantiation-depth limit.
function applyScope(
  query: FolderQuery,
  workspaceId: string,
  projectId: string | null,
): FolderQuery;
function applyScope(
  query: DocsQuery,
  workspaceId: string,
  projectId: string | null,
): DocsQuery;
function applyScope(
  query: FolderQuery | DocsQuery,
  workspaceId: string,
  projectId: string | null,
): FolderQuery | DocsQuery {
  const scoped = query.eq("workspace_id", workspaceId);
  return projectId === null
    ? scoped.is("project_id", null)
    : scoped.eq("project_id", projectId);
}

// Returns every folder for the given scope as a flat array, ordered by
// position — the UI (DocsSidebar, W3) builds the parent_id tree client-side
// rather than this query doing a recursive fetch.
export async function getDocFolders(
  workspaceId: string,
  projectId: string | null,
): Promise<DocFolder[]> {
  const supabase = await createClient();

  const { data, error } = await applyScope(
    docFoldersBaseQuery(supabase),
    workspaceId,
    projectId,
  ).order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapFolderRow);
}

// Returns the docs sitting directly inside the given folder (folderId ===
// null means the scope's root — not nested inside any folder).
export async function getDocsInFolder(
  workspaceId: string,
  projectId: string | null,
  folderId: string | null,
): Promise<Doc[]> {
  const supabase = await createClient();

  let query = applyScope(
    docsBaseQuery(supabase),
    workspaceId,
    projectId,
  );

  query = folderId === null ? query.is("folder_id", null) : query.eq("folder_id", folderId);

  const { data, error } = await query.order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapDocRow);
}

// Returns every doc for the given scope, regardless of folder — used for
// search/full-list views (e.g. the sidebar rendering the whole tree at
// once, W3).
export async function getAllDocs(
  workspaceId: string,
  projectId: string | null,
): Promise<Doc[]> {
  const supabase = await createClient();

  const { data, error } = await applyScope(
    docsBaseQuery(supabase),
    workspaceId,
    projectId,
  ).order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapDocRow);
}

// Fetches a single doc by id for the editor page. Returns null (not a
// thrown error) on "not found" or "no access" — RLS makes those
// indistinguishable from the caller's point of view, same convention as
// getProjectById's sibling queries returning null rather than throwing on
// a missing row.
export async function getDocById(docId: string): Promise<Doc | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("docs")
    .select(
      "id, workspace_id, project_id, folder_id, title, content, position, created_by, updated_by, created_at, updated_at",
    )
    .eq("id", docId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapDocRow(data);
}
