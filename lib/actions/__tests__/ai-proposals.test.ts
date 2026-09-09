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
const mockDelete = vi.fn();
const mockDeleteEq = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: mockSelect,
      delete: mockDelete,
    })),
  })),
}));

const mockCreateDoc = vi.fn();

vi.mock("@/lib/actions/docs", () => ({
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  createDoc: (...args: unknown[]) => mockCreateDoc(...args),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  applyDocCreateProposal,
  applyDocEditProposal,
} from "@/lib/actions/ai-proposals";
import { normalizeForStaleCheck } from "@/lib/ai/normalize-markdown";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

describe("applyDocEditProposal (F016)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockDelete.mockReturnValue({ eq: mockDeleteEq });
    mockDeleteEq.mockResolvedValue({ error: null });
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

// F017: unit tests for `applyDocCreateProposal` — the single, narrow write
// path for an accepted AI doc-create proposal.
//
// Covers:
// - AS-026: accepting creates the doc via the existing `createDoc` action
//   with the workspace/folder from the proposal, then writes the proposed
//   title/markdown via the existing `updateDoc` action — never a new/
//   parallel write path — and returns `{ id }` (no server-side navigation).
// - AS-002: both writes go through lib/actions/docs.ts's existing actions.
describe("applyDocCreateProposal (F017)", () => {
  const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
  const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
  const NEW_DOC_ID = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDoc.mockResolvedValue({ id: NEW_DOC_ID });
    mockUpdateDoc.mockResolvedValue({});
    mockDelete.mockReturnValue({ eq: mockDeleteEq });
    mockDeleteEq.mockResolvedValue({ error: null });
  });

  it("test_AS_026_happy_path_creates_via_createDoc_then_writes_title_and_markdown_via_updateDoc", async () => {
    const result = await applyDocCreateProposal({
      workspaceId: WORKSPACE_ID,
      title: "Q3 Retro Notes",
      markdown: "# Q3 Retro\n\nWhat went well.",
      folderId: FOLDER_ID,
    });

    expect(mockCreateDoc).toHaveBeenCalledWith(WORKSPACE_ID, FOLDER_ID, null);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      NEW_DOC_ID,
      "Q3 Retro Notes",
      "# Q3 Retro\n\nWhat went well.",
    );
    expect(result).toEqual({ id: NEW_DOC_ID });
  });

  it("test_AS_002_null_folderId_is_passed_through_to_createDoc_unchanged", async () => {
    await applyDocCreateProposal({
      workspaceId: WORKSPACE_ID,
      title: "Untitled Draft",
      markdown: "content",
      folderId: null,
    });

    expect(mockCreateDoc).toHaveBeenCalledWith(WORKSPACE_ID, null, null);
  });

  it("returns the createDoc error and never calls updateDoc when createDoc fails", async () => {
    mockCreateDoc.mockResolvedValue({ error: "Something went wrong. Please try again in a moment." });

    const result = await applyDocCreateProposal({
      workspaceId: WORKSPACE_ID,
      title: "Doc",
      markdown: "content",
      folderId: null,
    });

    expect(result).toEqual({ error: "Something went wrong. Please try again in a moment." });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  // M3-SCRUTINY.md BLOCKER-2: when the second write fails, the stub row
  // `createDoc` just persisted must be deleted so a retry cannot leave a
  // second orphan document behind.
  it("test_B2_returns_the_updateDoc_error_and_deletes_the_orphaned_stub_row_when_the_content_write_fails", async () => {
    mockUpdateDoc.mockResolvedValue({ error: "Something went wrong. Please try again in a moment." });

    const result = await applyDocCreateProposal({
      workspaceId: WORKSPACE_ID,
      title: "Doc",
      markdown: "content",
      folderId: null,
    });

    expect(result).toEqual({ error: "Something went wrong. Please try again in a moment." });
    expect(mockCreateDoc).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteEq).toHaveBeenCalledWith("id", NEW_DOC_ID);
  });

  // M3-SCRUTINY.md BLOCKER-2: a blank title must be rejected BEFORE
  // createDoc is ever called — `updateDoc` already rejects an empty title,
  // so validating first here means no orphan "Untitled" row is ever
  // created for a request that was always going to fail.
  it("test_B2_blank_title_is_rejected_before_createDoc_is_called_zero_orphan_rows", async () => {
    const result = await applyDocCreateProposal({
      workspaceId: WORKSPACE_ID,
      title: "   ",
      markdown: "content",
      folderId: null,
    });

    expect(result).toEqual({ error: "Title can't be empty." });
    expect(mockCreateDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
