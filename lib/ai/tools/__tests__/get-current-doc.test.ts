// F003: unit tests for the get_current_doc AI tool (AS-020, AS-021, AS-002,
// AS-028). Mocking style matches
// tests/unit/chat-mark-channel-read-action.test.ts — mock `createClient`
// from lib/supabase/server and stub the chained query-builder methods it
// uses. These are fast shape/truncation/empty-path tests only — they
// cannot and do not prove cross-workspace isolation (AS-008): see
// tests/integration/get-current-doc-isolation.test.ts for that (F024,
// fixing M1-SCRUTINY.md B2).

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { run } from "@/lib/ai/tools/get-current-doc";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

describe("get_current_doc (F003)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockCreateClient.mockResolvedValue({ from: mockFrom });
  });

  it("test_AS_020_returns_ok_with_correct_fields_for_a_visible_doc", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: DOC_ID,
        title: "Onboarding Guide",
        content: "# Hello\n\nWelcome to the team.",
        client_visible: true,
        doc_folders: { name: "Getting Started" },
      },
      error: null,
    });

    const result = await run({ docId: DOC_ID });

    expect(result).toEqual({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Onboarding Guide",
        markdown: "# Hello\n\nWelcome to the team.",
        folderName: "Getting Started",
        clientVisible: true,
        wordCount: 6,
        truncated: false,
      },
    });
    expect(mockFrom).toHaveBeenCalledWith("docs");
    expect(mockEq).toHaveBeenCalledWith("id", DOC_ID);
  });

  it("test_AS_021_AS_002_nonexistent_uuid_returns_empty_not_found", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await run({ docId: DOC_ID });

    expect(result).toEqual({
      status: "empty",
      reason: "not_found",
      message: "No matching document found.",
    });
  });

  it("test_a_null_row_returns_the_same_empty_shape_regardless_of_why_it_is_null", async () => {
    // NOT an isolation proof: this only exercises the tool's own
    // null-handling given a mocked `data: null`. The mock cannot tell the
    // tool "why" the row is null (true not-found vs. RLS-hidden), so this
    // case is indistinguishable from the not-found case above at the mock
    // level and would pass identically even with RLS dropped entirely or
    // a service-role client in place. The real cross-workspace isolation
    // property (AS-008) is proven against a live database in
    // tests/integration/get-current-doc-isolation.test.ts — see that
    // file's header for why a mock cannot make this claim.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await run({ docId: DOC_ID });

    expect(result.status).toBe("empty");
    if (result.status === "empty") {
      expect(result.reason).toBe("not_found");
      expect(result.message).toBe("No matching document found.");
      expect(JSON.stringify(result)).not.toMatch(/title|content|markdown/i);
    }
  });

  it("rejects a malformed docId without querying the database", async () => {
    const result = await run({ docId: "not-a-uuid" } as never);

    expect(result.status).toBe("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("truncates markdown over 40,000 characters and sets truncated: true", async () => {
    const longMarkdown = "word ".repeat(9000); // > 40_000 chars
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: DOC_ID,
        title: "Long Doc",
        content: longMarkdown,
        client_visible: false,
        doc_folders: null,
      },
      error: null,
    });

    const result = await run({ docId: DOC_ID });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.truncated).toBe(true);
      expect(result.data.markdown.length).toBe(40_000);
    }
  });
});
