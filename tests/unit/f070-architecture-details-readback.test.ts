// F070 (missions/20260919-150607, AS-060/AS-061/AS-062): the write side of
// content_seo/pm/qa discipline estimates is covered elsewhere, but the READ
// side -- getArchitectureNodeDetails (lib/queries/architecture-details.ts)
// mapping raw rows back into DisciplineEstimate objects -- had zero
// executing coverage. If a future refactor swapped which row field feeds
// which output field (e.g. content_seo's minutes landing under pm), no test
// would catch it. This test uses a DISTINCT minutes/note/estimatedBy value
// per discipline and asserts each exactly, so a pairwise swap fails.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const TASK_ID = "77777777-7777-4777-8777-777777777777";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const estimateRows = [
  {
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    discipline: "content_seo",
    minutes: 111,
    note: "content_seo note",
    estimated_by: "user-content-seo",
  },
  {
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    discipline: "pm",
    minutes: 222,
    note: "pm note",
    estimated_by: "user-pm",
  },
  {
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    discipline: "qa",
    minutes: 333,
    note: "qa note",
    estimated_by: "user-qa",
  },
  // F077 (AS-006): a cleared discipline is represented as a row with
  // minutes: null (see F073). The query chains .not("minutes", "is", null)
  // to filter these out -- this row must never appear in the result.
  {
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    discipline: "content_seo",
    minutes: null,
    note: "cleared note",
    estimated_by: "user-cleared",
  },
];

// Minimal query-builder stub with real filtering semantics for the two
// operators this module actually chains: .eq(column, value) and
// .not(column, "is", null). Both narrow the in-memory row set rather than
// no-op-ing, so a regression that stops filtering null minutes (or breaks
// the .not chain entirely) is caught here rather than only surfacing as a
// TypeError at runtime.
function buildEstimatesQuery(rows: typeof estimateRows) {
  return {
    select: vi.fn(() => buildFilterableQuery(rows)),
  };
}

function buildFilterableQuery(rows: typeof estimateRows) {
  const query: Record<string, unknown> = {
    eq: vi.fn((column: string, value: unknown) =>
      buildFilterableQuery(
        rows.filter((row) => (row as Record<string, unknown>)[column] === value),
      ),
    ),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      if (operator === "is" && value === null) {
        return buildResolvedQuery(rows.filter((row) => (row as Record<string, unknown>)[column] !== null));
      }
      return buildResolvedQuery(rows);
    }),
  };
  // Awaiting the query directly (without .not()) resolves with all rows
  // matched so far, matching Supabase's thenable query builder behaviour.
  (query as unknown as PromiseLike<unknown>).then = ((
    onfulfilled?: ((value: unknown) => unknown) | null,
  ) => Promise.resolve(onfulfilled ? onfulfilled({ data: rows, error: null }) : { data: rows, error: null })) as PromiseLike<unknown>["then"];
  return query;
}

function buildResolvedQuery(rows: typeof estimateRows) {
  return Promise.resolve({ data: rows, error: null });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "task_discipline_estimates") {
        return buildEstimatesQuery(estimateRows);
      }
      if (table === "architecture_node_meta") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getArchitectureNodeDetails } from "@/lib/queries/architecture-details";

describe("getArchitectureNodeDetails — AS-060/AS-061/AS-062 read-back mapping", () => {
  it("test_AS_060_content_seo_estimate_is_read_back_with_its_own_values", async () => {
    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const details = result.data.get(TASK_ID);
    expect(details).toBeDefined();
    const contentSeo = details!.estimates.find((e) => e.discipline === "content_seo");
    // Shape is deliberately {discipline, minutes, note} -- F036 removed
    // estimatedBy from DisciplineEstimate.
    expect(contentSeo).toEqual({
      discipline: "content_seo",
      minutes: 111,
      note: "content_seo note",
    });
  });

  it("test_AS_061_pm_estimate_is_read_back_with_its_own_values", async () => {
    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const details = result.data.get(TASK_ID);
    const pm = details!.estimates.find((e) => e.discipline === "pm");
    // Shape is deliberately {discipline, minutes, note} -- F036 removed
    // estimatedBy from DisciplineEstimate.
    expect(pm).toEqual({
      discipline: "pm",
      minutes: 222,
      note: "pm note",
    });
  });

  it("test_AS_062_qa_estimate_is_read_back_with_its_own_values", async () => {
    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const details = result.data.get(TASK_ID);
    const qa = details!.estimates.find((e) => e.discipline === "qa");
    // Shape is deliberately {discipline, minutes, note} -- F036 removed
    // estimatedBy from DisciplineEstimate.
    expect(qa).toEqual({
      discipline: "qa",
      minutes: 333,
      note: "qa note",
    });
  });

  it("a pairwise field swap between disciplines would fail this test (sanity: all three values are distinct)", async () => {
    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const details = result.data.get(TASK_ID);
    const minutesByDiscipline = new Map(details!.estimates.map((e) => [e.discipline, e.minutes]));
    expect(minutesByDiscipline.get("content_seo")).toBe(111);
    expect(minutesByDiscipline.get("pm")).toBe(222);
    expect(minutesByDiscipline.get("qa")).toBe(333);
    // Guard against a swap producing an accidental pass via loose equality.
    expect(minutesByDiscipline.get("content_seo")).not.toBe(minutesByDiscipline.get("pm"));
    expect(minutesByDiscipline.get("pm")).not.toBe(minutesByDiscipline.get("qa"));
    expect(minutesByDiscipline.get("content_seo")).not.toBe(minutesByDiscipline.get("qa"));
  });

  it("test_AS_006_cleared_discipline_row_with_null_minutes_is_excluded", async () => {
    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const details = result.data.get(TASK_ID);
    expect(details).toBeDefined();
    const contentSeoEstimates = details!.estimates.filter((e) => e.discipline === "content_seo");
    // Only the real (non-null minutes) content_seo row should survive the
    // .not("minutes", "is", null) filter -- the cleared row must not appear.
    expect(contentSeoEstimates).toHaveLength(1);
    // Shape is deliberately {discipline, minutes, note} -- F036 removed
    // estimatedBy from DisciplineEstimate.
    expect(contentSeoEstimates[0]).toEqual({
      discipline: "content_seo",
      minutes: 111,
      note: "content_seo note",
    });
    expect(details!.estimates.some((e) => e.minutes === null)).toBe(false);
  });
});
