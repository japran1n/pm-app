// F016: unit tests for `applyDocEditProposal` (lib/actions/ai-proposals.ts)
// — the single, narrow, auditable write path for an accepted AI doc-edit
// proposal.
//
// Covers:
// - AS-009: accepting writes exactly the proposed content (via the
//   existing `updateDoc` path, title preserved) and nothing else.
// - AS-002: data access goes through the RLS-respecting `createClient()`
//   for the read, and the existing `updateDoc` action for the write —
//   never a second/parallel write path.
// - Staleness guard: a live doc row that no longer matches
//   `expectedCurrentMarkdown` is rejected with zero write, with a clear,
//   non-destructive error message, normalised (trailing whitespace,
//   line endings) so invisible differences don't spuriously reject.
// - Not-found/not-visible collapses to a generic message.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockUpdateDoc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: mockSelect,
    })),
  })),
}));

vi.mock("@/lib/actions/docs", () => ({
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { applyDocEditProposal, normalizeForStaleCheck } from "@/lib/actions/ai-proposals";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

describe("applyDocEditProposal (F016)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockUpdateDoc.mockResolvedValue({});
  });

  it("test_AS_009_happy_path_writes_exactly_the_proposed_markdown_and_preserves_title", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { title: "Runbook", content: "# Runbook\nold body" },
      error: null,
    });

    const result = await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "# Runbook\nold body",
      proposedMarkdown: "# Runbook\nnew body",
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(DOC_ID, "Runbook", "# Runbook\nnew body");
  });

  it("test_AS_002_read_goes_through_the_rls_respecting_client_before_any_write", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { title: "Runbook", content: "same" },
      error: null,
    });

    await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "same",
      proposedMarkdown: "changed",
    });

    expect(mockSelect).toHaveBeenCalledWith("title, content");
    expect(mockEq).toHaveBeenCalledWith("id", DOC_ID);
  });

  it("test_F016_stale_document_is_rejected_with_zero_write", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { title: "Runbook", content: "# Runbook\nSOMEONE ELSE EDITED THIS" },
      error: null,
    });

    const result = await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "# Runbook\noriginal",
      proposedMarkdown: "# Runbook\nproposed",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "The document changed since this proposal was made. Please ask the assistant to revise it.",
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("test_F016_normalized_whitespace_and_line_ending_differences_do_not_trigger_a_false_staleness_rejection", async () => {
    // Trailing space on one line + CRLF vs LF — invisible differences.
    mockMaybeSingle.mockResolvedValue({
      data: { title: "Runbook", content: "# Runbook \r\nbody" },
      error: null,
    });

    const result = await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "# Runbook\nbody",
      proposedMarkdown: "# Runbook\nnew body",
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdateDoc).toHaveBeenCalledWith(DOC_ID, "Runbook", "# Runbook\nnew body");
  });

  it("test_F016_document_not_found_or_not_visible_returns_a_generic_error_with_zero_write", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "anything",
      proposedMarkdown: "anything else",
    });

    expect(result).toEqual({ ok: false, error: "That document could not be found." });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("test_F016_requires_a_signed_in_user_and_performs_zero_calls_otherwise", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await applyDocEditProposal({
      docId: DOC_ID,
      expectedCurrentMarkdown: "x",
      proposedMarkdown: "y",
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to apply this change.",
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  describe("normalizeForStaleCheck", () => {
    it("strips trailing per-line whitespace and normalises CRLF to LF", () => {
      expect(normalizeForStaleCheck("a \r\nb\t\nc")).toBe("a\nb\nc");
    });
  });
});
