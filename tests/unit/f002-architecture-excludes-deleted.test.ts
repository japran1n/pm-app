// F002 (missions/20260914-portal-simplify, AS-003): unit coverage that
// `getArchitectureBoardForClient` (lib/queries/architecture.ts) excludes
// soft-deleted pages/sections (`deleted_at is not null`) from the portal
// Site map, on top of RLS.
//
// Mocks a chained Supabase query builder using the shared filter-honouring
// helpers (tests/unit/helpers/query-filter-mock.ts) so the test genuinely
// exercises the `.is("deleted_at", null)` call site: deleting that call
// from the real code would make this test fail because a soft-deleted
// page/section row would then leak into the result, not merely because a
// chain method disappeared.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, eqFilter, isNullFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let taskRows: Row[];
const componentRows: Row[] = [
  { id: "comp-1", name: "Hero", description: null, position: 0 },
];

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
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: componentRows, error: null })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  })),
}));

import { getArchitectureBoardForClient } from "@/lib/queries/architecture";

describe("F002 / AS-003: getArchitectureBoardForClient excludes soft-deleted rows", () => {
  it("excludes a soft-deleted page from the returned pages", async () => {
    taskRows = [
      {
        id: "page-active",
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
        id: "page-deleted",
        title: "Old Landing",
        page_slug: "old-landing",
        page_kind: "static",
        section_kind: null,
        component_id: null,
        parent_task_id: null,
        position: 1,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pageIds = result.data.pages.map((p) => p.id);
    expect(pageIds).toContain("page-active");
    expect(pageIds).not.toContain("page-deleted");
  });

  it("excludes a soft-deleted section from its parent page's sections and its component's instance count", async () => {
    taskRows = [
      {
        id: "page-active",
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
        id: "section-active",
        title: "Hero Section",
        page_slug: null,
        page_kind: null,
        section_kind: "static",
        component_id: "comp-1",
        parent_task_id: "page-active",
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "section-deleted",
        title: "Removed Section",
        page_slug: null,
        page_kind: null,
        section_kind: "static",
        component_id: "comp-1",
        parent_task_id: "page-active",
        position: 1,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const home = result.data.pages.find((p) => p.id === "page-active");
    expect(home).toBeDefined();
    const sectionIds = home?.sections.map((s) => s.id) ?? [];
    expect(sectionIds).toContain("section-active");
    expect(sectionIds).not.toContain("section-deleted");

    const hero = result.data.components.find((c) => c.id === "comp-1");
    expect(hero?.instanceCount).toBe(1);
  });
});
