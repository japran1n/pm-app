// Read-side for F022's `project_links` and `project_accounts`
// (missions/20260903-portal, M5 — Site, guides, trust: AS-049, AS-050).
// Mirrors lib/queries/project-records.ts's file shape exactly: the
// RLS-respecting server client, never the admin client — RLS
// (20261014010000) already restricts a client caller to portal-enabled
// projects they belong to and, additionally, `client_visible = true`
// rows on both tables.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type ProjectLinkKind =
  | "staging"
  | "live"
  | "figma"
  | "sitemap"
  | "drive"
  | "webflow"
  | "gtm"
  | "analytics"
  | "search_console"
  | "other";

export type ProjectLink = {
  id: string;
  projectId: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
  clientVisible: boolean;
  position: number;
};

export type ProjectAccountOwner = "client" | "agency";
export type ProjectAccountStatus = "pending" | "provisioned" | "transferred";

export type ProjectAccount = {
  id: string;
  projectId: string;
  service: string;
  owner: ProjectAccountOwner;
  status: ProjectAccountStatus;
  renewalDate: string | null;
  note: string | null;
  clientVisible: boolean;
  position: number;
};

// AS-049: every link on this project, in position order. For a client,
// RLS already excludes both non-`client_visible` rows and rows on a
// portal-disabled/invisible project entirely — this file never applies
// a client_visible filter itself.
export async function getProjectLinks(
  projectId: string,
): Promise<PortalQueryResult<ProjectLink[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_links")
    .select("id, project_id, kind, label, url, client_visible, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getProjectLinks: failed to load links", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      kind: row.kind as ProjectLinkKind,
      label: row.label,
      url: row.url,
      clientVisible: row.client_visible,
      position: row.position,
    })),
  };
}

// AS-050: every account on this project, in position order. No field in
// this row ever holds a credential value (CHECK + Zod refinement, both
// in the migration/lib/validation/project-accounts.ts) — this read side
// simply returns whatever the write side allowed in.
export async function getProjectAccounts(
  projectId: string,
): Promise<PortalQueryResult<ProjectAccount[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_accounts")
    .select(
      "id, project_id, service, owner, status, renewal_date, note, client_visible, position",
    )
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getProjectAccounts: failed to load accounts", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      service: row.service,
      owner: row.owner as ProjectAccountOwner,
      status: row.status as ProjectAccountStatus,
      renewalDate: row.renewal_date,
      note: row.note,
      clientVisible: row.client_visible,
      position: row.position,
    })),
  };
}
