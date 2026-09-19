// F07 (missions/20260919-staging-preview, SP-053, SP-003): unit coverage
// for getClientVisibleStagingLinks (lib/queries/project-site.ts) with a
// mocked Supabase query builder, same filter-honouring pattern
// tests/unit/portal-phases-query.test.ts establishes and
// tests/unit/helpers/query-filter-mock.ts shares — a mock that ignores
// `.eq()`/`.in()` arguments and unconditionally hands back the fixture
// rows cannot prove the real query's double filter (client_visible AND
// kind) is genuinely applied, only that the chain's shape exists.
//
// SP-002/SP-003: getClientVisibleStagingLinks must apply BOTH
// `.eq("client_visible", true)` and `.in("kind", ["staging", "live"])`,
// and a Supabase error must produce `{ ok: false }` — never an empty
// list, which would be indistinguishable from "this project genuinely
// has no staging links".

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let linkRows: Row[];
let linksError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "project_links") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              order: vi.fn(async () => {
                if (linksError) return { data: null, error: linksError };
                return { data: applyFilters(linkRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getClientVisibleStagingLinks } from "@/lib/queries/project-site";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function link(overrides: Partial<Row> = {}): Row {
  return {
    id: "link-1",
    project_id: PROJECT_ID,
    kind: "staging",
    label: "Staging",
    url: "https://staging.example.com",
    client_visible: true,
    position: 1,
    ...overrides,
  };
}

beforeEach(() => {
  linkRows = [];
  linksError = null;
});

describe("getClientVisibleStagingLinks — SP-053: both filters are genuinely applied", () => {
  it("test_SP_053_excludes_a_client_visible_false_row_even_when_its_kind_matches", async () => {
    // If the real `.eq("client_visible", true)` call were ever dropped,
    // this mock would hand the hidden row back too.
    linkRows = [
      link({ id: "visible", client_visible: true }),
      link({ id: "hidden", client_visible: false }),
    ];

    const result = await getClientVisibleStagingLinks(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.id)).toEqual(["visible"]);
  });

  it("test_SP_053_excludes_a_row_whose_kind_is_not_staging_or_live_even_when_visible", async () => {
    // If the real `.in("kind", ["staging", "live"])` call were ever
    // dropped, this mock would hand the figma row back too.
    linkRows = [
      link({ id: "staging-row", kind: "staging" }),
      link({ id: "live-row", kind: "live" }),
      link({ id: "figma-row", kind: "figma" }),
    ];

    const result = await getClientVisibleStagingLinks(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.id).sort()).toEqual(["live-row", "staging-row"]);
  });

  it("test_SP_053_applies_both_filters_together_not_just_one", async () => {
    linkRows = [
      link({ id: "keep", kind: "live", client_visible: true }),
      link({ id: "wrong-kind", kind: "webflow", client_visible: true }),
      link({ id: "hidden", kind: "staging", client_visible: false }),
    ];

    const result = await getClientVisibleStagingLinks(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.id)).toEqual(["keep"]);
  });

  it("returns an empty list, not an error, when the project genuinely has no matching links", async () => {
    linkRows = [];

    const result = await getClientVisibleStagingLinks(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("getClientVisibleStagingLinks — SP-003: a failed read never falls back to an empty list", () => {
  it("test_SP_003_a_supabase_error_returns_ok_false_not_an_empty_array", async () => {
    linkRows = [link({ id: "would-have-been-returned" })];
    linksError = { message: "connection reset" };

    const result = await getClientVisibleStagingLinks(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
    // Explicitly distinguish from the legitimate "no rows" case: an
    // error must never be reported as `{ ok: true, data: [] }`.
    expect(result).not.toEqual({ ok: true, data: [] });
  });
});
