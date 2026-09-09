// F017: unit tests for the create_doc AI tool (AS-026, AS-002, AS-028).
// Mocking style matches get-current-doc.test.ts — mock `createClient` from
// lib/supabase/server and stub the chained query-builder methods it uses.
// AS-003 (no write reachable from this file) is proven separately by
// lib/ai/tools/__tests__/no-writes.test.ts's AST walk, which now also
// covers this file since it lives under lib/ai/tools/.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { run } from "@/lib/ai/tools/create-doc";

const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";

describe("create_doc (F017)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockCreateClient.mockResolvedValue({ from: mockFrom });
  });

  it("test_AS_026_happy_path_with_no_folder_returns_a_draft_envelope_and_writes_nothing", async () => {
    const result = await run(
      {
        title: "Q3 Retro Notes",
        markdown: "# Q3 Retro\n\nWhat went well.",
        folderId: null,
        templateName: null,
      },
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      status: "ok",
      data: {
        kind: "doc_create",
        proposalId: expect.any(String),
        title: "Q3 Retro Notes",
        markdown: "# Q3 Retro\n\nWhat went well.",
        folderId: null,
        templateName: null,
      },
    });
    // No database call at all when folderId is null — nothing to validate.
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("test_AS_026_happy_path_with_a_valid_folder_and_template_returns_them_in_the_envelope", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: FOLDER_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });

    const result = await run(
      {
        title: "Runbook: Deploys",
        markdown: "# Deploys\n\nSteps.",
        folderId: FOLDER_ID,
        templateName: "Runbook",
      },
      WORKSPACE_ID,
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.kind).toBe("doc_create");
    expect(result.data.folderId).toBe(FOLDER_ID);
    expect(result.data.templateName).toBe("Runbook");
    expect(mockFrom).toHaveBeenCalledWith("doc_folders");
    expect(mockEq).toHaveBeenCalledWith("id", FOLDER_ID);
  });

  it("test_AS_028_nonexistent_folder_returns_empty_not_found_and_proposes_nothing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await run(
      { title: "Doc", markdown: "content", folderId: FOLDER_ID, templateName: null },
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      status: "empty",
      reason: "not_found",
      message: "No matching folder found.",
    });
  });

  it("test_AS_028_AS_002_folder_belonging_to_a_different_workspace_returns_the_identical_not_found_shape", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: FOLDER_ID, workspace_id: OTHER_WORKSPACE_ID },
      error: null,
    });

    const result = await run(
      { title: "Doc", markdown: "content", folderId: FOLDER_ID, templateName: null },
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      status: "empty",
      reason: "not_found",
      message: "No matching folder found.",
    });
  });

  it("rejects a missing title without querying the database", async () => {
    const result = await run(
      { title: "   ", markdown: "content", folderId: null, templateName: null } as never,
      WORKSPACE_ID,
    );

    expect(result.status).toBe("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed folderId without querying the database", async () => {
    const result = await run(
      { title: "Doc", markdown: "content", folderId: "not-a-uuid", templateName: null } as never,
      WORKSPACE_ID,
    );

    expect(result.status).toBe("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
