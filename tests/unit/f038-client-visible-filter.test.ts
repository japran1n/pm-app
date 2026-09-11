// F038 (missions/20260910-182104, AS-098): unit coverage that
// `getArchitectureBoardForClient` (lib/queries/architecture.ts) applies
// `client_visible = true` on top of RLS when reading `tasks`, so a page
// (or section) the team hasn't marked client-visible is excluded from the
// portal board it assembles, not merely hidden by the UI.
//
// Mocks a chained Supabase query builder using the shared filter-honouring
// helpers (tests/unit/helpers/query-filter-mock.ts) so the test genuinely
// exercises the `.eq("client_visible", true)` call site: deleting that
// call from the real code would make this test fail because a
// non-client-visible page row would then leak into the result, not merely
// because a chain method disappeared.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, eqFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let taskRows: Row[];
const componentRows: Row[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            // Supports `.eq("project_id", ...).eq("client_visible", true)`
            // chains: `.eq()` records its own predicate and returns a
            // thenable builder so any number of chained `.eq()` calls
            // resolve to the fully-filtered row set, same as the real
            // Supabase query builder.
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return {
                  eq: chain.eq,
                  then: (resolve: (v: unknown) => void) =>
                    resolve({ data: applyFilters(taskRows, filters), error: null }),
                };
              }),
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

describe("F038 / AS-098: getArchitectureBoardForClient filters by client_visible", () => {
  it("excludes a page whose task row has client_visible = false", async () => {
    taskRows = [
      {
        id: "page-visible",
        title: "Home",
        page_slug: "home",
        page_kind: "static",
        component_id: null,
        parent_task_id: null,
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: true,
      },
      {
        id: "page-hidden",
        title: "Internal Admin",
        page_slug: "admin",
        page_kind: "static",
        component_id: null,
        parent_task_id: null,
        position: 1,
        description_text: null,
        project_id: "proj-1",
        client_visible: false,
      },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pageIds = result.data.pages.map((p) => p.id);
    expect(pageIds).toContain("page-visible");
    expect(pageIds).not.toContain("page-hidden");
  });

  it("returns only client-visible pages when all pages are hidden", async () => {
    taskRows = [
      {
        id: "page-hidden-only",
        title: "Draft",
        page_slug: "draft",
        page_kind: "static",
        component_id: null,
        parent_task_id: null,
        position: 0,
        description_text: null,
        project_id: "proj-1",
        client_visible: false,
      },
    ];

    const result = await getArchitectureBoardForClient("proj-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pages).toHaveLength(0);
  });
});
