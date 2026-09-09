// F004: unit tests for the search_docs AI tool (AS-022, AS-028). Mocking
// style matches lib/ai/tools/__tests__/get-current-doc.test.ts — mock
// `createClient` from lib/supabase/server and stub the chained
// query-builder methods it uses. The query builder here
// (`.from().select().or().limit()`, with an optional `.eq()` when
// `projectId` is given) is awaited directly rather than terminated with
// `.maybeSingle()`, so the mock returns a thenable object from `limit()`
// that resolves to the query result whether or not `.eq()` is chained
// after it.
//
// These are fast shape/snippet/empty-path tests only — they cannot and do
// not prove cross-workspace isolation (AS-023, AS-008): see
// tests/integration/search-docs-isolation.test.ts for that (F024, fixing
// M1-SCRUTINY.md B2).

import { describe, expect, it, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown[] | null; error: unknown };

let currentResult: QueryResult = { data: [], error: null };

const mockEq = vi.fn(() => Promise.resolve(currentResult));
const mockLimit = vi.fn(() => ({
  eq: mockEq,
  then: (
    resolve: (value: QueryResult) => void,
    reject: (reason: unknown) => void,
  ) => Promise.resolve(currentResult).then(resolve, reject),
}));
const mockOr = vi.fn(() => ({ limit: mockLimit }));
const mockSelect = vi.fn(() => ({ or: mockOr }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { run } from "@/lib/ai/tools/search-docs";

function makeDocRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Onboarding Guide",
    content:
      "Welcome to the team. This document explains the onboarding checklist and covers your first week here in detail.",
    project_id: "22222222-2222-4222-8222-222222222222",
    doc_folders: { name: "Getting Started" },
    ...overrides,
  };
}

describe("search_docs (F004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentResult = { data: [], error: null };
    mockCreateClient.mockResolvedValue({ from: mockFrom });
  });

  it("test_AS_022_happy_path_returns_shaped_results_capped_at_10", async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeDocRow({
        id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`,
        title: `Doc ${i}`,
      }),
    );
    currentResult = { data: rows, error: null };

    const result = await run({ query: "onboarding" });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.results).toHaveLength(10);
      const first = result.data.results[0];
      expect(first).toEqual({
        docId: rows[0].id,
        title: "Doc 0",
        folderName: "Getting Started",
        snippet: expect.stringContaining("onboarding"),
      });
    }
    expect(mockFrom).toHaveBeenCalledWith("docs");
  });

  it("scopes to a project when projectId is provided", async () => {
    currentResult = { data: [makeDocRow()], error: null };

    await run({
      query: "onboarding",
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    expect(mockEq).toHaveBeenCalledWith(
      "project_id",
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("test_AS_no_results_returns_empty_no_results", async () => {
    currentResult = { data: [], error: null };

    const result = await run({ query: "nonexistent-term-xyz" });

    expect(result).toEqual({
      status: "empty",
      reason: "no_results",
      message: "No matching documents found.",
    });
  });

  it("test_a_single_row_result_set_is_shaped_and_serialized_correctly", async () => {
    // NOT an isolation proof: the mock only ever contains rows the test
    // itself put there, so asserting the output "doesn't mention a
    // foreign workspace" proves nothing about a real workspace boundary —
    // it would pass identically with RLS dropped entirely or a
    // service-role client in place. The real cross-workspace isolation
    // property (AS-023, AS-008) is proven against a live database in
    // tests/integration/search-docs-isolation.test.ts — see that file's
    // header for why a mock cannot make this claim.
    const ownWorkspaceDoc = makeDocRow({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Own Workspace Doc",
    });
    currentResult = { data: [ownWorkspaceDoc], error: null };

    const result = await run({ query: "doc" });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].docId).toBe(ownWorkspaceDoc.id);
    }
  });

  it("falls back to the document opening when the match is only in the title", async () => {
    const row = makeDocRow({
      title: "UniqueTitleMatch",
      content: "This body has nothing to do with the query at all.",
    });
    currentResult = { data: [row], error: null };

    const result = await run({ query: "UniqueTitleMatch" });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.results[0].snippet).toContain("This body has nothing");
    }
  });

  it("rejects an empty query without querying the database", async () => {
    const result = await run({ query: "   " } as never);

    expect(result.status).toBe("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
