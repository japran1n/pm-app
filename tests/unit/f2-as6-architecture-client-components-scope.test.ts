// 20260915-status-sitemap-audit, F2 (AS-6): `getArchitectureBoardForClient`'s
// `page_components` query used to select every component row for the whole
// project, unscoped -- identical to the unfiltered team-side query. Harmless
// only so long as the portal discarded the array outright
// (client-board.tsx used to `void components`); this feature wires that
// array into a real, client-facing Components panel (AS-9), so an
// internal-only component linked solely to a hidden/non-client-visible
// section must never be fetched or named for the client.
//
// Mocks a chained Supabase query builder using the shared filter-honouring
// helpers (tests/unit/helpers/query-filter-mock.ts), same convention
// tests/unit/f002-architecture-excludes-deleted.test.ts uses, so this test
// genuinely exercises the real `.eq("client_visible", true)` /
// `.is("deleted_at", null)` / `.in("id", ...)` filters rather than a mock
// that would pass even if the code under test dropped them.

import { describe, expect, it, vi } from "vitest";
import {
  applyFilters,
  eqFilter,
  inFilter,
  isNullFilter,
  type Row,
} from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let taskRows: Row[];
let componentRows: Row[];
let capturedComponentFilterIds: unknown[] | null;
let pageComponentsQueried: boolean;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return chain;
              }),
              is: vi.fn((col: string, val: unknown) => {
                if (val === null) filters.push(isNullFilter(col));
                return {
                  eq: chain.eq,
                  is: chain.is,
                  then: (resolve: (v: unknown) => void) =>
                    resolve({ data: applyFilters(taskRows, filters), error: null }),
                };
              }),
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: applyFilters(taskRows, filters), error: null }),
            };
            return chain;
          }),
        };
      }
      if (table === "page_components") {
        pageComponentsQueried = true;
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return chain;
              }),
              in: vi.fn((col: string, vals: readonly unknown[]) => {
                capturedComponentFilterIds = [...vals];
                filters.push(inFilter(col, vals));
                return {
                  then: (resolve: (v: unknown) => void) =>
                    resolve({ data: applyFilters(componentRows, filters), error: null }),
                };
              }),
            };
            return chain;
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  })),
}));

import { getArchitectureBoardForClient } from "@/lib/queries/architecture";

describe("F2 / AS-6: getArchitectureBoardForClient scopes components to returned sections", () => {
  it("only returns a component referenced by a returned (client-visible) section, not every project component", async () => {
    capturedComponentFilterIds = null;
    pageComponentsQueried = false;

    taskRows = [
      {
        id: "page-1",
        title: "Home",
        page_slug: "home",
        page_kind: "static",
        section_kind: null,
        component_id: null,
        parent_task_id: null,
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "section-1",
        title: "Hero",
        page_slug: null,
        page_kind: null,
        section_kind: "static",
        component_id: "comp-shared",
        parent_task_id: "page-1",
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: null,
      },
    ];
    componentRows = [
      { id: "comp-shared", name: "Hero Block", description: null, position: 0, project_id: "proj-1" },
      // A component that exists in the project but is not referenced by
      // any returned section -- proves the `.in("id", ...)` filter is
      // real, not a mock that echoes back every row regardless.
      { id: "comp-unreferenced", name: "Unused Component", description: null, position: 1, project_id: "proj-1" },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(pageComponentsQueried).toBe(true);
    expect(capturedComponentFilterIds).toEqual(["comp-shared"]);
    const componentIds = result.data.components.map((c) => c.id);
    expect(componentIds).toEqual(["comp-shared"]);
    expect(componentIds).not.toContain("comp-unreferenced");
  });

  it("never fetches/leaks a component that is only linked to a non-client-visible section", async () => {
    capturedComponentFilterIds = null;
    pageComponentsQueried = false;

    taskRows = [
      {
        id: "page-1",
        title: "Home",
        page_slug: "home",
        page_kind: "static",
        section_kind: null,
        component_id: null,
        parent_task_id: null,
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: null,
      },
      // Hidden section: client_visible: false, filtered out of the
      // `tasks` result -- its linked component must never surface.
      {
        id: "section-hidden",
        title: "Internal admin panel",
        page_slug: null,
        page_kind: null,
        section_kind: "static",
        component_id: "comp-internal-only",
        parent_task_id: "page-1",
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: false,
        deleted_at: null,
      },
    ];
    componentRows = [
      { id: "comp-internal-only", name: "Internal Admin Widget", description: null, position: 0, project_id: "proj-1" },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No component referenced by any returned section -- the
    // `page_components` table must not even be queried, let alone
    // return the internal-only component's name.
    expect(pageComponentsQueried).toBe(false);
    expect(result.data.components).toEqual([]);
  });
});
