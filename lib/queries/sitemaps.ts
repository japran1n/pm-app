// Standalone Sitemap tool, Phase 1: read side for sitemaps that are NOT
// tied to any project. See supabase/migrations/20261128010000_sitemaps.sql's
// header for the schema this reads (sitemaps / sitemap_pages /
// sitemap_sections / sitemap_components / sitemap_shares).
//
// `getSitemapBoard` / `resolveSitemapShareToken` both return the EXISTING
// `ArchitectureBoard` shape from lib/queries/architecture.ts
// (`{ pages: BoardPage[], components: BoardComponent[] }`) so the
// existing canvas component renders a standalone sitemap unchanged --
// those types are imported, never redeclared, here.
//
// No N+1: each function issues exactly two queries -- one for
// sitemap_pages + sitemap_sections (an `.in("page_id", pageIds)` scoped
// to this sitemap's own pages), one for sitemap_components -- same
// two-query shape architecture.ts's getArchitectureBoard uses, adapted to
// this schema's actual parent/child tables (a "page" here is its own row,
// not a `tasks` row, so there's no single tasks-table trick to split
// pages/sections out of one result set; two explicit queries is simpler
// and just as N+1-free).
//
// `resolveSitemapShareToken` uses the ADMIN client (bypasses RLS) by
// design -- see the migration's header note: the public share route does
// not rely on anon RLS at all. It resolves the token to a sitemap id
// itself, then reuses the same row-shaping path as getSitemapBoard. An
// unknown or revoked token resolves to `{ ok: true, data: null }` (a
// well-formed "no such sitemap" answer, not an error) so the calling
// route can render a 404 without treating a bad/expired link as a system
// failure.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortalQueryResult } from "@/lib/queries/portal";
import type {
  ArchitectureBoard,
  BoardPageKind,
  BoardSectionKind,
} from "@/lib/queries/architecture";

export type SitemapListItem = {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type SupabaseLike = ReturnType<typeof createAdminClient>;

const PAGE_COLUMNS = "id, title, slug, kind, position";
const SECTION_COLUMNS = "id, page_id, title, kind, component_id, position";
const COMPONENT_COLUMNS = "id, name, position";

type PageRow = {
  id: string;
  title: string;
  slug: string;
  kind: string | null;
  position: number;
};

type SectionRow = {
  id: string;
  page_id: string;
  title: string;
  kind: string;
  component_id: string | null;
  position: number;
};

type ComponentRow = {
  id: string;
  name: string;
  position: number;
};

// Pure row-shaping, mirrors architecture.ts's buildBoardFromRows -- kept
// as its own exported function so it's independently unit-testable
// without a database round trip (lib/queries/sitemaps.select.test.ts).
export function buildSitemapBoardFromRows(
  pageRows: PageRow[],
  sectionRows: SectionRow[],
  componentRows: ComponentRow[],
): ArchitectureBoard {
  const sortedPages = [...pageRows].sort((a, b) => a.position - b.position);

  const sectionsByPageId = new Map<string, SectionRow[]>();
  for (const row of sectionRows) {
    const existing = sectionsByPageId.get(row.page_id);
    if (existing) {
      existing.push(row);
    } else {
      sectionsByPageId.set(row.page_id, [row]);
    }
  }

  const componentById = new Map<string, ComponentRow>();
  for (const component of componentRows) {
    componentById.set(component.id, component);
  }

  const instanceCountByComponentId = new Map<string, number>();
  for (const row of sectionRows) {
    if (row.component_id === null) continue;
    instanceCountByComponentId.set(
      row.component_id,
      (instanceCountByComponentId.get(row.component_id) ?? 0) + 1,
    );
  }

  const pages = sortedPages.map((page) => {
    const sections = (sectionsByPageId.get(page.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((section) => {
        const component = section.component_id
          ? componentById.get(section.component_id) ?? null
          : null;

        return {
          id: section.id,
          title: section.title,
          position: section.position,
          kind: (section.kind === "cms" ? "cms" : "static") as BoardSectionKind,
          component: component ? { id: component.id, name: component.name } : null,
        };
      });

    return {
      id: page.id,
      title: page.title,
      pageSlug: page.slug,
      pageKind: (page.kind as BoardPageKind | null) ?? null,
      position: page.position,
      sections,
    };
  });

  const components = [...componentRows]
    .sort((a, b) => a.position - b.position)
    .map((component) => ({
      id: component.id,
      name: component.name,
      position: component.position,
      instanceCount: instanceCountByComponentId.get(component.id) ?? 0,
    }));

  return { pages, components };
}

async function loadBoard(
  supabase: SupabaseLike,
  sitemapId: string,
): Promise<PortalQueryResult<ArchitectureBoard>> {
  const pagesResult = await supabase
    .from("sitemap_pages")
    .select(PAGE_COLUMNS)
    .eq("sitemap_id", sitemapId);

  if (pagesResult.error) {
    logger.error("getSitemapBoard: failed to load pages", {
      error: pagesResult.error,
    });
    return { ok: false, error: pagesResult.error.message };
  }

  const pageRows = (pagesResult.data ?? []) as PageRow[];
  const pageIds = pageRows.map((row) => row.id);

  const [sectionsResult, componentsResult] = await Promise.all([
    pageIds.length > 0
      ? supabase.from("sitemap_sections").select(SECTION_COLUMNS).in("page_id", pageIds)
      : Promise.resolve({ data: [] as SectionRow[], error: null }),
    supabase.from("sitemap_components").select(COMPONENT_COLUMNS).eq("sitemap_id", sitemapId),
  ]);

  if (sectionsResult.error) {
    logger.error("getSitemapBoard: failed to load sections", {
      error: sectionsResult.error,
    });
    return { ok: false, error: sectionsResult.error.message };
  }

  if (componentsResult.error) {
    logger.error("getSitemapBoard: failed to load components", {
      error: componentsResult.error,
    });
    return { ok: false, error: componentsResult.error.message };
  }

  return {
    ok: true,
    data: buildSitemapBoardFromRows(
      pageRows,
      (sectionsResult.data ?? []) as SectionRow[],
      (componentsResult.data ?? []) as ComponentRow[],
    ),
  };
}

// List every non-archived-or-not sitemap visible (via RLS) to the caller
// in a given workspace, most recently updated first.
export async function listSitemaps(
  workspaceId: string,
): Promise<PortalQueryResult<SitemapListItem[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sitemaps")
    .select("id, workspace_id, name, created_by, created_at, updated_at, archived_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    logger.error("listSitemaps: failed to load sitemaps", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    })),
  };
}

// Phase 2 (sitemap editor top bar): the sitemap's own name/metadata --
// getSitemapBoard below returns only the board shape (pages/components,
// shared with the project-backed Architecture tab), which has no `name`
// field of its own, same reasoning as SitemapShareData's own header note
// further down this file.
export async function getSitemapById(
  sitemapId: string,
): Promise<PortalQueryResult<SitemapListItem | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sitemaps")
    .select("id, workspace_id, name, created_by, created_at, updated_at, archived_at")
    .eq("id", sitemapId)
    .maybeSingle();

  if (error) {
    logger.error("getSitemapById: failed to load sitemap", { error });
    return { ok: false, error: error.message };
  }

  if (!data) {
    return { ok: true, data: null };
  }

  return {
    ok: true,
    data: {
      id: data.id,
      workspaceId: data.workspace_id,
      name: data.name,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      archivedAt: data.archived_at,
    },
  };
}

// Loads one sitemap as an ArchitectureBoard, RLS-gated (ordinary server
// client -- the caller must be an active member of the sitemap's
// workspace, same as every other read in this module).
export async function getSitemapBoard(
  sitemapId: string,
): Promise<PortalQueryResult<ArchitectureBoard>> {
  const supabase = await createClient();
  return loadBoard(supabase, sitemapId);
}

// Phase 2 (sitemap list + editor share dialog): "is this sitemap
// currently shared, and if so what's its active token" for one or many
// sitemaps at once -- an ordinary member-RLS read (sitemap_shares does
// have a member select policy, see the migration), never the admin
// client. `revoked_at is null` is "active"; a sitemap can have at most
// one active share by construction of createSitemapShare/revokeSitemapShare
// (revoke marks the row revoked rather than deleting it, so old tokens
// stay inert forever instead of being reusable).
export async function listActiveSitemapShareTokens(
  sitemapIds: string[],
): Promise<PortalQueryResult<Record<string, string>>> {
  if (sitemapIds.length === 0) {
    return { ok: true, data: {} };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sitemap_shares")
    .select("sitemap_id, token")
    .in("sitemap_id", sitemapIds)
    .is("revoked_at", null);

  if (error) {
    logger.error("listActiveSitemapShareTokens: failed to load shares", { error });
    return { ok: false, error: error.message };
  }

  const byId: Record<string, string> = {};
  for (const row of data ?? []) {
    byId[row.sitemap_id] = row.token;
  }

  return { ok: true, data: byId };
}

export async function getActiveSitemapShareToken(
  sitemapId: string,
): Promise<PortalQueryResult<string | null>> {
  const result = await listActiveSitemapShareTokens([sitemapId]);
  if (!result.ok) return result;
  return { ok: true, data: result.data[sitemapId] ?? null };
}

// Phase 3 (public share route): the board shape alone has no `name` --
// that lives on the parent `sitemaps` row, not on `ArchitectureBoard`
// (which is shared with the project-backed Architecture tab and never
// carries a title of its own). The share route's top bar needs the
// sitemap's name, so this wraps the board with it rather than adding a
// name field to the shared `ArchitectureBoard` type (that type is
// imported, never redeclared or widened, per this file's header).
export type SitemapShareData = {
  name: string;
  board: ArchitectureBoard;
};

// Resolves a share token to a sitemap board, entirely via the admin
// client (bypasses RLS by design -- see this file's header and the
// migration's header note). Returns `{ ok: true, data: null }` for an
// unknown or revoked token -- not found is not a query failure.
export async function resolveSitemapShareToken(
  token: string,
): Promise<PortalQueryResult<SitemapShareData | null>> {
  // Public share route: no authenticated caller, no RLS to lean on;
  // ARCH-003's admin-client restriction only applies to lib/actions/**
  // (see eslint.config.mjs) -- this is a query module. Token itself is
  // the sole credential, validated below before any data is returned.
  const admin = createAdminClient();

  const { data: shareRow, error: shareError } = await admin
    .from("sitemap_shares")
    .select("sitemap_id, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (shareError) {
    logger.error("resolveSitemapShareToken: failed to load share", {
      error: shareError,
    });
    return { ok: false, error: shareError.message };
  }

  if (!shareRow || shareRow.revoked_at !== null) {
    return { ok: true, data: null };
  }

  const [sitemapResult, boardResult] = await Promise.all([
    admin.from("sitemaps").select("name").eq("id", shareRow.sitemap_id).maybeSingle(),
    loadBoard(admin, shareRow.sitemap_id),
  ]);

  if (sitemapResult.error) {
    logger.error("resolveSitemapShareToken: failed to load sitemap name", {
      error: sitemapResult.error,
    });
    return { ok: false, error: sitemapResult.error.message };
  }

  if (!sitemapResult.data) {
    // Sitemap row itself is gone even though the share row still exists
    // (should not happen given the FK, but treat it the same as an
    // unknown/revoked token rather than surfacing a query error).
    return { ok: true, data: null };
  }

  if (!boardResult.ok) {
    return boardResult;
  }

  return { ok: true, data: { name: sitemapResult.data.name, board: boardResult.data } };
}
