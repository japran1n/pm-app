// F005: unit tests for the list_doc_templates AI tool (AS-024, AS-002,
// AS-028). Mocking style matches
// lib/ai/tools/__tests__/search-docs.test.ts — mock `createClient` from
// lib/supabase/server and stub the chained query-builder methods it uses.
// This tool's query is `.from().select().eq()`, awaited directly (no
// terminal `.maybeSingle()`), so the mock's `eq()` return value must be a
// thenable resolving to the query result.

import { describe, expect, it, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown[] | null; error: unknown };

let currentResult: QueryResult = { data: [], error: null };

const mockEq = vi.fn(() => Promise.resolve(currentResult));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { run } from "@/lib/ai/tools/list-doc-templates";

function makeTemplateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Standard Runbook",
    payload: {
      sections: ["Overview", "Steps", "Rollback"],
      rules: ["Use imperative voice", "One action per step"],
      tone: "concise",
      folderHint: "Runbooks",
    },
    ...overrides,
  };
}

describe("list_doc_templates (F005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentResult = { data: [], error: null };
    mockCreateClient.mockResolvedValue({ from: mockFrom });
  });

  it("test_AS_024_happy_path_returns_only_doc_kind_shaped_templates", async () => {
    currentResult = { data: [makeTemplateRow()], error: null };

    const result = await run({});

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.templates).toEqual([
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Standard Runbook",
          sections: ["Overview", "Steps", "Rollback"],
          rules: ["Use imperative voice", "One action per step"],
          tone: "concise",
          folderHint: "Runbooks",
        },
      ]);
    }
    expect(mockFrom).toHaveBeenCalledWith("task_templates");
    expect(mockEq).toHaveBeenCalledWith("kind", "doc");
  });

  it("test_AS_002_scoping_relies_entirely_on_rls_no_extra_workspace_filter_needed", async () => {
    // RLS (`task_templates_select_non_guest_members`) already scopes every
    // row this query can return to the caller's own workspace — a
    // foreign-workspace template simply never appears in `data`, exactly
    // like get_current_doc/search_docs's precedent. The mock simulates
    // that boundary by only ever including the caller's own row.
    const ownWorkspaceTemplate = makeTemplateRow({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Own Workspace Template",
    });
    currentResult = { data: [ownWorkspaceTemplate], error: null };

    const result = await run({});

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.templates).toHaveLength(1);
      expect(result.data.templates[0].id).toBe(ownWorkspaceTemplate.id);
      const serialized = JSON.stringify(result.data.templates);
      expect(serialized).not.toMatch(/foreign|other-workspace/i);
    }
  });

  it("test_AS_028_no_results_returns_empty_no_results", async () => {
    currentResult = { data: [], error: null };

    const result = await run({});

    expect(result).toEqual({
      status: "empty",
      reason: "no_results",
      message: "No document templates found.",
    });
  });

  it("test_AS_028_malformed_payload_is_skipped_not_thrown", async () => {
    const malformed = makeTemplateRow({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Legacy/broken template",
      payload: { sections: "not-an-array", rules: [] },
    });
    const valid = makeTemplateRow({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Valid template",
    });
    currentResult = { data: [malformed, valid], error: null };

    const result = await run({});

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.templates).toHaveLength(1);
      expect(result.data.templates[0].id).toBe(valid.id);
    }
  });

  it("test_AS_028_all_payloads_malformed_returns_empty_no_results", async () => {
    const malformed = makeTemplateRow({ payload: { garbage: true } });
    currentResult = { data: [malformed], error: null };

    const result = await run({});

    expect(result).toEqual({
      status: "empty",
      reason: "no_results",
      message: "No document templates found.",
    });
  });

  it("optional tone/folderHint default to null when absent", async () => {
    const row = makeTemplateRow({
      payload: { sections: ["Only"], rules: ["Only rule"] },
    });
    currentResult = { data: [row], error: null };

    const result = await run({});

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.templates[0].tone).toBeNull();
      expect(result.data.templates[0].folderHint).toBeNull();
    }
  });

  it("returns an error result, never throws, on a database error", async () => {
    currentResult = { data: null, error: { message: "boom" } };

    const result = await run({});

    expect(result.status).toBe("error");
  });
});
