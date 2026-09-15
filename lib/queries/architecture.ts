// Mission 20260910-182104, F004: read-side for the architecture board.
// Standing decision 1 (clarifications/standing-decisions.md): a page IS a
// task with `page_slug` set and `parent_task_id is null`; a section IS
// that page task's subtask (`parent_task_id = <page task id>`). This file
// assembles both, plus each section's linked `page_components` row, into
// one board shape -- no page hierarchy beyond that flat two-level split
// (standing decision 2: no `parent_page_id`).
//
// Mirrors lib/queries/page-links.ts's own unfiltered/client-filtered pair
// convention: `getArchitectureBoard` stays UNFILTERED by `client_visible`
// for the team-side board, `getArchitectureBoardForClient` is the portal's
// own double-guarded sibling, applying `client_visible = true` explicitly
// on top of RLS -- the same belt-and-suspenders reasoning
// lib/queries/portal.ts documents at its `client_visible` filter sites
// (e.g. line ~1621-1622: "SELECT on `tasks` already only returns
// client_visible rows ... so filtering here on client_visible again is
// belt-and-suspenders, not the source of truth").
//
// No N+1: each function issues exactly two queries -- one for
// pages+sections (a single `tasks` select scoped to `project_id`, split in
// memory into pages vs. sections by `parent_task_id`), and one for
// `page_components` with instance counts computed by a single grouped
// count query, not a per-component round trip. Zero-instance components
// are included by starting from the full component list and defaulting
// the count to 0, not by inferring components only from linked sections.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type BoardPageKind = "static" | "cms" | "cms_template" | "utility";

/** Where a section's content comes from. Orthogonal to `component` --
 *  a section can be CMS-driven AND rendered by a shared component. */
export type BoardSectionKind = "static" | "cms";

export type BoardSectionComponent = {
  id: string;
  name: string;
};

export type BoardSection = {
  id: string;
  title: string;
  position: number;
  kind: BoardSectionKind;
  component: BoardSectionComponent | null;
  clientVisible?: boolean;
};

export type BoardPage = {
  id: string;
  title: string;
  pageSlug: string;
  pageKind: BoardPageKind | null;
  position: number;
  description: string | null;
  sections: BoardSection[];
  clientVisible?: boolean;
};

export type BoardComponent = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  instanceCount: number;
};

export type ArchitectureBoard = {
  pages: BoardPage[];
  components: BoardComponent[];
};

const TASK_COLUMNS =
  "id, title, page_slug, page_kind, section_kind, component_id, parent_task_id, position, description_text, client_visible";

type TaskRow = {
  id: string;
  title: string;
  page_slug: string | null;
  page_kind: string | null;
  section_kind: string | null;
  component_id: string | null;
  parent_task_id: string | null;
  position: number;
  description_text: string | null;
  client_visible?: boolean | null;
};

const COMPONENT_COLUMNS = "id, name, description, position";

type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  position: number;
};

export function buildBoardFromRows(
  taskRows: TaskRow[],
  componentRows: ComponentRow[],
): ArchitectureBoard {
  const pageRows = taskRows
    .filter((row) => row.page_slug !== null && row.parent_task_id === null)
    .sort((a, b) => a.position - b.position);

  const sectionsByPageId = new Map<string, TaskRow[]>();
  for (const row of taskRows) {
    if (row.parent_task_id === null) continue;
    const existing = sectionsByPageId.get(row.parent_task_id);
    if (existing) {
      existing.push(row);
    } else {
      sectionsByPageId.set(row.parent_task_id, [row]);
    }
  }

  const componentById = new Map<string, ComponentRow>();
  for (const component of componentRows) {
    componentById.set(component.id, component);
  }

  // Instance counts computed once here in memory from the already-fetched
  // task rows -- a single pass, not a query per component.
  const instanceCountByComponentId = new Map<string, number>();
  for (const row of taskRows) {
    if (row.component_id === null) continue;
    instanceCountByComponentId.set(
      row.component_id,
      (instanceCountByComponentId.get(row.component_id) ?? 0) + 1,
    );
  }

  const pages: BoardPage[] = pageRows.map((page) => {
    const sectionRows = (sectionsByPageId.get(page.id) ?? []).sort(
      (a, b) => a.position - b.position,
    );

    const sections: BoardSection[] = sectionRows.map((section) => {
      const component = section.component_id
        ? componentById.get(section.component_id) ?? null
        : null;

      return {
        id: section.id,
        title: section.title,
        position: section.position,
        kind: section.section_kind === "cms" ? "cms" : "static",
        component: component ? { id: component.id, name: component.name } : null,
        clientVisible: section.client_visible === true,
      };
    });

    return {
      id: page.id,
      title: page.title,
      pageSlug: page.page_slug as string,
      pageKind: (page.page_kind as BoardPageKind | null) ?? null,
      position: page.position,
      description:
        page.description_text && page.description_text.length > 0
          ? page.description_text
          : null,
      sections,
      clientVisible: page.client_visible === true,
    };
  });

  const components: BoardComponent[] = [...componentRows]
    .sort((a, b) => a.position - b.position)
    .map((component) => ({
      id: component.id,
      name: component.name,
      description: component.description,
      position: component.position,
      instanceCount: instanceCountByComponentId.get(component.id) ?? 0,
    }));

  return { pages, components };
}

// Unfiltered by client_visible -- team-side architecture board. See file
// header.
export async function getArchitectureBoard(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureBoard>> {
  const supabase = await createClient();

  const [tasksResult, componentsResult] = await Promise.all([
    supabase.from("tasks").select(TASK_COLUMNS).eq("project_id", projectId),
    supabase
      .from("page_components")
      .select(COMPONENT_COLUMNS)
      .eq("project_id", projectId),
  ]);

  if (tasksResult.error) {
    logger.error("getArchitectureBoard: failed to load tasks", {
      error: tasksResult.error,
    });
    return { ok: false, error: tasksResult.error.message };
  }

  if (componentsResult.error) {
    logger.error("getArchitectureBoard: failed to load components", {
      error: componentsResult.error,
    });
    return { ok: false, error: componentsResult.error.message };
  }

  return {
    ok: true,
    data: buildBoardFromRows(
      (tasksResult.data ?? []) as TaskRow[],
      (componentsResult.data ?? []) as ComponentRow[],
    ),
  };
}

// AS-062/AS-063/AS-065/AS-066 (this mission's own, see handoff): the
// portal's architecture board calls this, never the unfiltered pair
// above -- explicit `client_visible = true` on top of RLS
// (`page_components_select_client` / the tasks client SELECT policy),
// matching every other portal read's double-guard convention
// (lib/queries/page-links.ts, lib/queries/portal.ts).
//
// F002 (missions/20260914-portal-simplify, AS-003): also excludes
// soft-deleted pages/sections with `.is("deleted_at", null)`, on top of
// RLS's own `deleted_at is null` SELECT check -- same belt-and-suspenders
// reasoning as the `client_visible` filter above. Because
// `buildBoardFromRows`'s sections and instance counts are both derived
// from this same already-filtered task row set, a soft-deleted page's
// components are dropped from the board's instance counts for free; no
// separate "components only for returned pages" filter is needed on the
// `page_components` query itself.
//
// 20260915-status-sitemap-audit, F2 (AS-6): the `page_components` query
// used to select every component row for the whole project, unscoped --
// identical to the unfiltered team-side query. That was harmless only so
// long as the portal discarded the `components` array outright
// (components/architecture/client-board.tsx used to `void components`).
// The moment a Components panel renders that array to the client (F2's
// own AS-9), an internal-only component that's only ever linked to
// hidden/non-client-visible sections would leak its name and existence.
// Fixed by making the two queries sequential (not Promise.all) and
// deriving the allowed component id set from the ALREADY client-visible-
// filtered, non-deleted task rows above -- a component is only fetched
// when at least one *returned* section links to it, never "every
// component in the project."
export async function getArchitectureBoardForClient(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureBoard>> {
  const supabase = await createClient();

  const tasksResult = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("project_id", projectId)
    .eq("client_visible", true)
    .is("deleted_at", null);

  if (tasksResult.error) {
    logger.error("getArchitectureBoardForClient: failed to load tasks", {
      error: tasksResult.error,
    });
    return { ok: false, error: tasksResult.error.message };
  }

  const taskRows = (tasksResult.data ?? []) as TaskRow[];

  // AS-6: the set of component ids referenced by at least one returned
  // (client-visible, non-deleted) section -- computed from the row set
  // above, not from a separate unscoped project-wide query.
  const referencedComponentIds = Array.from(
    new Set(
      taskRows
        .map((row) => row.component_id)
        .filter((id): id is string => id !== null),
    ),
  );

  if (referencedComponentIds.length === 0) {
    return { ok: true, data: buildBoardFromRows(taskRows, []) };
  }

  const componentsResult = await supabase
    .from("page_components")
    .select(COMPONENT_COLUMNS)
    .eq("project_id", projectId)
    .in("id", referencedComponentIds);

  if (componentsResult.error) {
    logger.error("getArchitectureBoardForClient: failed to load components", {
      error: componentsResult.error,
    });
    return { ok: false, error: componentsResult.error.message };
  }

  return {
    ok: true,
    data: buildBoardFromRows(
      taskRows,
      (componentsResult.data ?? []) as ComponentRow[],
    ),
  };
}
