// F004: unit tests for the search_docs AI tool (AS-022, AS-028), updated for
// F026/M1d — the query now runs one bound `.ilike()` call per column
// (title, content) instead of hand-interpolating a `.or()` filter string,
// and merges+dedupes the two result sets client-side. The mock below
// mirrors that chain: `.from().select().ilike(column, pattern).order().
// limit()`, with an optional `.eq()` when `projectId` is given.
//
// These are fast shape/snippet/empty-path tests only — they cannot and do
// not prove cross-workspace isolation (AS-023, AS-008): see
// tests/integration/search-docs-isolation.test.ts for that (F024, fixing
// M1-SCRUTINY.md B2).

import { describe, expect, it, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown[] | null; error: unknown };

// One result set per column so tests can control title vs. content matches
// independently; defaults to empty for both.
let resultsByColumn: Record<"title" | "content", QueryResult> = {
  title: { data: [], error: null },
  content: { data: [], error: null },
};

const eqSpy = vi.fn();
const ilikeCalls: Array<{ column: string; pattern: string }> = [];

function makeTerminal(column: "title" | "content") {
  const terminal = {
    eq: vi.fn((...args: unknown[]) => {
      eqSpy(...args);
      return terminal;
    }),
    then: (
      resolve: (value: QueryResult) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(resultsByColumn[column]).then(resolve, reject),
  };
  return terminal;
}

const mockIlike = vi.fn((column: "title" | "content", pattern: string) => {
  ilikeCalls.push({ column, pattern });
  return {
    order: vi.fn(() => ({
      limit: vi.fn(() => makeTerminal(column)),
    })),
  };
});
const mockSelect = vi.fn(() => ({ ilike: mockIlike }));
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
    ilikeCalls.length = 0;
    resultsByColumn = {
      title: { data: [], error: null },
      content: { data: [], error: null },
    };
    mockCreateClient.mockResolvedValue({ from: mockFrom });
  });

  it("test_AS_022_happy_path_returns_shaped_results_capped_at_10", async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeDocRow({
        id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`,
        title: `Doc ${i}`,
      }),
    );
    resultsByColumn.title = { data: rows, error: null };

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
    resultsByColumn.title = { data: [makeDocRow()], error: null };

    await run({
      query: "onboarding",
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    expect(eqSpy).toHaveBeenCalledWith(
      "project_id",
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("test_AS_no_results_returns_empty_no_results", async () => {
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
    resultsByColumn.title = { data: [ownWorkspaceDoc], error: null };

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
    resultsByColumn.title = { data: [row], error: null };

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

  it("merges and dedupes title and content matches for the same document", async () => {
    const row = makeDocRow({ id: "44444444-4444-4444-8444-444444444444" });
    // Same row surfaces from both column queries — must appear only once.
    resultsByColumn.title = { data: [row], error: null };
    resultsByColumn.content = { data: [row], error: null };

    const result = await run({ query: "onboarding" });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.results).toHaveLength(1);
    }
  });

  describe("test_AS_M1d_query_with_postgrest_grammar_characters_is_not_injected_as_filter_syntax", () => {
    it("passes a query containing a comma, dot and parentheses through as a single bound pattern, never building a filter string", async () => {
      // The motivating case from the spec: "budget, revised" — under the
      // old `.or(\`title.ilike.${pattern},content.ilike.${pattern}\`)`
      // string-interpolation approach, the comma would inject an extra
      // top-level OR term into PostgREST's filter grammar. Parentheses and
      // a dot are also grammar metacharacters there.
      const injectionQuery = "budget, revised (Q3).report";

      await run({ query: injectionQuery });

      // Every .ilike() call must receive the query as an opaque bound
      // pattern argument (wildcard-escaped), never spliced into a filter
      // string — proven here by the fact `.ilike()` (not `.or()`) is what
      // the mocked query builder exposes at all, and by asserting the
      // pattern argument contains the punctuation verbatim (escaped only
      // for %/_, not stripped or reinterpreted as grammar).
      expect(mockIlike).toHaveBeenCalled();
      for (const call of ilikeCalls) {
        expect(call.pattern).toContain(",");
        expect(call.pattern).toContain(".");
        expect(call.pattern).toContain("(");
        expect(call.pattern).toContain(")");
      }
    });

    it("returns sane (non-error) results for a comma-containing query instead of injected OR terms", async () => {
      const row = makeDocRow({ title: "Q3 budget, revised" });
      resultsByColumn.title = { data: [row], error: null };

      const result = await run({ query: "budget, revised" });

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.results).toHaveLength(1);
      }
    });
  });

  it("test_AS_M1d_results_are_deterministically_ordered", async () => {
    // .order() must be called on the query chain so which MAX_RESULTS of N
    // rows come back is not arbitrary.
    resultsByColumn.title = { data: [makeDocRow()], error: null };

    await run({ query: "onboarding" });

    const ilikeReturn = mockIlike.mock.results[0]?.value as { order: ReturnType<typeof vi.fn> };
    expect(ilikeReturn.order).toHaveBeenCalledWith("id", { ascending: true });
  });
});
