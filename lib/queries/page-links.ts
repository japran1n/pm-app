// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// read-side for `page_links` (20261101020000). Mirrors
// lib/queries/project-site.ts's file shape and its own unfiltered/
// client-filtered pair convention: `getPageLinksByTaskId` stays
// UNFILTERED by `client_visible` for the team-side editor (task detail),
// `getClientVisiblePageLinksByTaskId` is the portal's own
// double-guarded sibling, applying `client_visible = true` explicitly on
// top of RLS (20261101020000's `page_links_select_client` policy),
// matching the reasoning `lib/queries/portal.ts:337-342` documents for
// every other portal read in this mission.
//
// Both functions are batched by an array of task ids -- the Pages table
// renders one row per task, and this is exactly the "no N+1" shape
// `getPortalPages` itself already uses for assignee resolution.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type PageLinkKind =
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

export type PageLink = {
  id: string;
  taskId: string;
  kind: PageLinkKind;
  label: string;
  url: string;
  clientVisible: boolean;
  position: number;
};

const PAGE_LINK_COLUMNS = "id, task_id, kind, label, url, client_visible, position";

function mapPageLinkRow(row: {
  id: string;
  task_id: string;
  kind: string;
  label: string;
  url: string;
  client_visible: boolean;
  position: number;
}): PageLink {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind as PageLinkKind,
    label: row.label,
    url: row.url,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

function groupByTaskId(links: PageLink[]): Map<string, PageLink[]> {
  const byTask = new Map<string, PageLink[]>();
  for (const link of links) {
    const existing = byTask.get(link.taskId);
    if (existing) {
      existing.push(link);
    } else {
      byTask.set(link.taskId, [link]);
    }
  }
  return byTask;
}

// Unfiltered by client_visible -- for the team-side editor (task detail
// sheet). See file header.
export async function getPageLinksForTask(taskId: string): Promise<PortalQueryResult<PageLink[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("page_links")
    .select(PAGE_LINK_COLUMNS)
    .eq("task_id", taskId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getPageLinksForTask: failed to load links", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapPageLinkRow) };
}

// Batched, unfiltered read for every task id in one query -- used
// nowhere client-facing today, kept for parity with the client-visible
// sibling below and any future team-side "all pages" view.
export async function getPageLinksByTaskIds(
  taskIds: string[],
): Promise<PortalQueryResult<Map<string, PageLink[]>>> {
  if (taskIds.length === 0) return { ok: true, data: new Map() };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("page_links")
    .select(PAGE_LINK_COLUMNS)
    .in("task_id", taskIds)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getPageLinksByTaskIds: failed to load links", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: groupByTaskId((data ?? []).map(mapPageLinkRow)) };
}

// AS-113 (this feature's own, see handoff): the portal's Pages view
// calls this, never the unfiltered pair above -- explicit
// `client_visible = true` on top of RLS, matching every other portal
// read's double-guard convention.
export async function getClientVisiblePageLinksByTaskIds(
  taskIds: string[],
): Promise<PortalQueryResult<Map<string, PageLink[]>>> {
  if (taskIds.length === 0) return { ok: true, data: new Map() };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("page_links")
    .select(PAGE_LINK_COLUMNS)
    .in("task_id", taskIds)
    .eq("client_visible", true)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getClientVisiblePageLinksByTaskIds: failed to load links", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: groupByTaskId((data ?? []).map(mapPageLinkRow)) };
}
