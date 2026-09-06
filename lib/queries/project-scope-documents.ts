// Read-side for `project_scope_documents` (20261106010000). Mirrors
// lib/queries/project-records.ts's file shape: the RLS-respecting server
// client, never the admin client — RLS already restricts a client caller
// to portal-enabled projects they belong to (this table has no
// `client_visible` column: everything attached here is, by definition,
// a client-facing artefact for this page — see the migration's own
// header comment).
//
// Uploader display name is resolved via the shared `resolvePeople`
// batched lookup (lib/queries/people.ts), the same one-query-for-every-id
// convention lib/queries/assignee-names.ts and lib/queries/members.ts
// already follow, rather than an embedded PostgREST join — there is no
// direct foreign key from `project_scope_documents.uploaded_by` to
// `profiles.id` for PostgREST to embed through (both independently
// reference `auth.users(id)`).

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type ScopeDocumentKind = "upload" | "link";

export type ScopeDocument = {
  id: string;
  projectId: string;
  title: string;
  kind: ScopeDocumentKind;
  filePath: string | null;
  url: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
};

export async function getProjectScopeDocuments(
  projectId: string,
): Promise<PortalQueryResult<ScopeDocument[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_scope_documents")
    .select("id, project_id, title, kind, file_path, url, uploaded_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getProjectScopeDocuments: failed to load scope documents", { error });
    return { ok: false, error: error.message };
  }

  const rows = data ?? [];
  const people = await resolvePeople([...new Set(rows.map((row) => row.uploaded_by))]);

  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      kind: row.kind as ScopeDocumentKind,
      filePath: row.file_path,
      url: row.url,
      uploadedBy: row.uploaded_by,
      uploadedByName: people.get(row.uploaded_by)?.name ?? null,
      createdAt: row.created_at,
    })),
  };
}
