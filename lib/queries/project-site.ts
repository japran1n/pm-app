// Read-side for F022's `project_links` and `project_accounts`
// (missions/20260903-portal, M5 — Site, guides, trust: AS-049, AS-050).
// Mirrors lib/queries/project-records.ts's file shape exactly: the
// RLS-respecting server client, never the admin client — RLS
// (20261014010000) already restricts a client caller to portal-enabled
// projects they belong to and, additionally, `client_visible = true`
// rows on both tables.
//
// `getProjectLinks`/`getProjectAccounts` stay UNFILTERED by
// `client_visible` on purpose: the team settings "Site" panel
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/site/page.tsx)
// calls them to render every row, including hidden ones, so a team
// member can toggle visibility. `getClientVisiblePortalLinks`/
// `getClientVisiblePortalAccounts` below are the portal's own
// double-guarded siblings (F025e): each applies `client_visible = true`
// explicitly, matching the convention and reasoning
// lib/queries/portal.ts:337-342 documents for getProjectPhases — the
// filter is each function's own contract ("client-facing links"/
// "client-facing accounts"), applied explicitly rather than left
// entirely to RLS so it holds even for a team caller previewing the
// portal, not only for an actual client session. The portal's site page
// (app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx) calls
// only these two, never the unfiltered pair above.

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

function mapLinkRow(row: {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  url: string;
  client_visible: boolean;
  position: number;
}): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as ProjectLinkKind,
    label: row.label,
    url: row.url,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

function mapAccountRow(row: {
  id: string;
  project_id: string;
  service: string;
  owner: string;
  status: string;
  renewal_date: string | null;
  note: string | null;
  client_visible: boolean;
  position: number;
}): ProjectAccount {
  return {
    id: row.id,
    projectId: row.project_id,
    service: row.service,
    owner: row.owner as ProjectAccountOwner,
    status: row.status as ProjectAccountStatus,
    renewalDate: row.renewal_date,
    note: row.note,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

// AS-049: every link on this project, in position order — unfiltered by
// client_visible, for the team settings panel. See file header.
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

  return { ok: true, data: (data ?? []).map(mapLinkRow) };
}

// AS-050: every account on this project, in position order — unfiltered
// by client_visible, for the team settings panel. No field in this row
// ever holds a credential value (CHECK + Zod refinement, both in the
// migration/lib/validation/project-accounts.ts) — this read side simply
// returns whatever the write side allowed in. See file header.
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

  return { ok: true, data: (data ?? []).map(mapAccountRow) };
}

// AS-049 (F025e): the portal's own double-guarded sibling of
// getProjectLinks — same read, plus the explicit `client_visible = true`
// predicate described in the file header. This is the function the
// portal's site page calls; getProjectLinks above stays unfiltered for
// the team settings panel.
export async function getClientVisiblePortalLinks(
  projectId: string,
): Promise<PortalQueryResult<ProjectLink[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_links")
    .select("id, project_id, kind, label, url, client_visible, position")
    .eq("project_id", projectId)
    .eq("client_visible", true)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getClientVisiblePortalLinks: failed to load links", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapLinkRow) };
}

// AS-050 (F025e): the portal's own double-guarded sibling of
// getProjectAccounts — same read, plus the explicit
// `client_visible = true` predicate described in the file header. This
// is the function the portal's site page calls; getProjectAccounts above
// stays unfiltered for the team settings panel.
export async function getClientVisiblePortalAccounts(
  projectId: string,
): Promise<PortalQueryResult<ProjectAccount[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_accounts")
    .select(
      "id, project_id, service, owner, status, renewal_date, note, client_visible, position",
    )
    .eq("project_id", projectId)
    .eq("client_visible", true)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getClientVisiblePortalAccounts: failed to load accounts", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapAccountRow) };
}
