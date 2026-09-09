// F014: unit tests for the propose_doc_edit AI tool (AS-025, AS-028, AS-043
// at the data-shape level; AS-003's actual enforcement lives in
// no-writes.test.ts). Mocking style matches get-current-doc.test.ts /
// search-docs.test.ts: mock this tool's two collaborators —
// lib/ai/tools/get-current-doc's `run` (reused, not re-implemented) and
// lib/ai/client's `getAnthropicClient` — and assert on the returned
// ToolResult envelope. Never touches a real network or database.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetCurrentDocRun = vi.fn();
vi.mock("@/lib/ai/tools/get-current-doc", () => ({
  run: (...args: unknown[]) => mockGetCurrentDocRun(...args),
}));

const mockCreate = vi.fn();
const mockGetAnthropicClient = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  DOCS_MODEL: "claude-opus-5",
  getAnthropicClient: (...args: unknown[]) => mockGetAnthropicClient(...args),
}));

import { run } from "@/lib/ai/tools/propose-doc-edit";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";

function mockModelText(text: string) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text }],
  });
}

describe("propose_doc_edit (F014)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAnthropicClient.mockReturnValue({
      beta: { messages: { create: mockCreate } },
    });
  });

  it("test_AS_025_happy_path_returns_a_proposal_envelope_with_docId_proposedMarkdown_and_a_computed_diff", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Onboarding Guide",
        markdown: "# Hello\n\nWelcome.",
        folderName: null,
        clientVisible: false,
        wordCount: 3,
        truncated: false,
      },
    });
    mockModelText("# Hello\n\nWelcome to the team!");

    const result = await run(
      { docId: DOC_ID, instruction: "Make the welcome line warmer" },
      WORKSPACE_ID,
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.kind).toBe("doc_edit");
    expect(result.data.docId).toBe(DOC_ID);
    expect(result.data.docTitle).toBe("Onboarding Guide");
    // Load-bearing per lib/ai/tools/types.ts: currentMarkdown is the exact
    // text the diff was computed against, unmodified.
    expect(result.data.currentMarkdown).toBe("# Hello\n\nWelcome.");
    expect(result.data.proposedMarkdown).toBe("# Hello\n\nWelcome to the team!");
    expect(typeof result.data.proposalId).toBe("string");
    expect(result.data.proposalId.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data.diff)).toBe(true);
    expect(result.data.diff.length).toBeGreaterThan(0);
    // At least one line actually marked changed, not just context.
    expect(result.data.diff.some((line) => line.type === "added" || line.type === "removed")).toBe(
      true,
    );
  });

  it("test_AS_025_uses_a_separate_non_streaming_high_effort_call_distinct_from_the_chat_turn", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Doc",
        markdown: "old",
        folderName: null,
        clientVisible: false,
        wordCount: 1,
        truncated: false,
      },
    });
    mockModelText("new");

    await run({ docId: DOC_ID, instruction: "change it" }, WORKSPACE_ID);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.output_config).toEqual({ effort: "high" });
    expect(callArgs.thinking).toEqual({ type: "adaptive" });
    // Non-streaming: `.stream(` is never called on this collaborator, only
    // the plain, awaited `.create(`.
  });

  it("test_AS_021_not_found_doc_returns_the_identical_get_current_doc_empty_shape", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "empty",
      reason: "not_found",
      message: "No matching document found.",
    });

    const result = await run(
      { docId: DOC_ID, instruction: "anything" },
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      status: "empty",
      reason: "not_found",
      message: "No matching document found.",
    });
    // The model must never be called for a doc the caller can't see.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("test_F027_cross_workspace_doc_is_not_visible_and_never_reaches_the_model", async () => {
    // get_current_doc's own run() collapses "belongs to a different
    // workspace" into the same not_found empty shape (F027) — this tool
    // must pass that straight through and must never call the model for
    // a doc it doesn't consider visible to the caller's current workspace.
    mockGetCurrentDocRun.mockResolvedValue({
      status: "empty",
      reason: "not_found",
      message: "No matching document found.",
    });

    const result = await run(
      { docId: DOC_ID, instruction: "reveal contents" },
      WORKSPACE_ID,
    );

    expect(result.status).toBe("empty");
    if (result.status === "empty") {
      expect(result.reason).toBe("not_found");
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGetCurrentDocRun).toHaveBeenCalledWith({ docId: DOC_ID }, WORKSPACE_ID);
  });

  it("test_AS_043_identical_revision_returns_empty_no_results_instead_of_an_empty_diff_proposal", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Doc",
        markdown: "Nothing to change here.",
        folderName: null,
        clientVisible: false,
        wordCount: 4,
        truncated: false,
      },
    });
    mockModelText("Nothing to change here.");

    const result = await run(
      { docId: DOC_ID, instruction: "tweak the tone slightly" },
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      status: "empty",
      reason: "no_results",
      message: "No change was needed for that instruction.",
    });
  });

  it("unwraps a markdown code fence the model wrapped its answer in despite instructions not to", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Doc",
        markdown: "old text",
        folderName: null,
        clientVisible: false,
        wordCount: 2,
        truncated: false,
      },
    });
    mockModelText("```markdown\nnew text\n```");

    const result = await run({ docId: DOC_ID, instruction: "change it" }, WORKSPACE_ID);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.proposedMarkdown).toBe("new text");
    }
  });

  it("rejects a malformed docId without calling get_current_doc or the model", async () => {
    const result = await run({ docId: "not-a-uuid", instruction: "x" } as never, WORKSPACE_ID);

    expect(result.status).toBe("error");
    expect(mockGetCurrentDocRun).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a blank instruction without calling get_current_doc or the model", async () => {
    const result = await run({ docId: DOC_ID, instruction: "   " }, WORKSPACE_ID);

    expect(result.status).toBe("error");
    expect(mockGetCurrentDocRun).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps an upstream model failure to a safe generic error, never the raw thrown message", async () => {
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: {
        docId: DOC_ID,
        title: "Doc",
        markdown: "old",
        folderName: null,
        clientVisible: false,
        wordCount: 1,
        truncated: false,
      },
    });
    mockCreate.mockRejectedValue(new Error("upstream 500: secret trace abc123"));

    const result = await run({ docId: DOC_ID, instruction: "change it" }, WORKSPACE_ID);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).not.toMatch(/secret|trace|abc123/i);
    }
  });
});
