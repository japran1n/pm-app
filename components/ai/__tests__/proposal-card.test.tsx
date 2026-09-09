// @vitest-environment jsdom
//
// F015/F016: behavioural tests for ProposalCard (components/ai/
// proposal-card.tsx).
//
// Covers:
// - AS-064: a pending proposal renders a card with a visible diff and
//   Accept/Reject buttons.
// - AS-065: clicking Accept calls the write path (applyDocEditProposal),
//   applies the change through the editor bridge, and collapses the card
//   to a single accepted row — and never allows a second decision.
// - AS-066: clicking Reject collapses the card to a rejected row, and
//   performs ZERO calls to the write path or the editor bridge (the
//   document is unchanged) — never allows a second decision.
// - AS-069: Accept/Reject are real <button> elements (keyboard-operable)
//   with the app's standard visible focus-ring classes.
// - AS-070: no raw hex literal anywhere in this file's rendered classes.
// - F016 stale guard: when the editor bridge's live content differs from
//   the proposal's `currentMarkdown`, Accept surfaces the stale error and
//   never calls the write path at all.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockApplyDocEditProposal = vi.fn();
vi.mock("@/lib/actions/ai-proposals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/actions/ai-proposals")>(
    "@/lib/actions/ai-proposals",
  );
  return {
    ...actual,
    applyDocEditProposal: (...args: unknown[]) => mockApplyDocEditProposal(...args),
  };
});

const mockGetDocEditorHandle = vi.fn();
vi.mock("@/lib/ai/doc-editor-bridge", () => ({
  getDocEditorHandle: (...args: unknown[]) => mockGetDocEditorHandle(...args),
}));

import { ProposalCard } from "@/components/ai/proposal-card";
import type { ProposalView } from "@/lib/ai/use-doc-assistant";

const PAYLOAD = {
  kind: "doc_edit" as const,
  proposalId: "p1",
  docId: "doc-1",
  docTitle: "Runbook",
  currentMarkdown: "# Runbook\nold body",
  proposedMarkdown: "# Runbook\nnew body",
  summary: 'Proposed edit to "Runbook".',
  diff: [
    { type: "context" as const, value: "# Runbook\n" },
    { type: "removed" as const, value: "old body\n" },
    { type: "added" as const, value: "new body\n" },
  ],
};

function pendingProposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return { id: "p1", kind: "doc_edit", payload: PAYLOAD, status: "pending", ...overrides };
}

describe("ProposalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDocEditorHandle.mockReturnValue(null);
    mockApplyDocEditProposal.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("test_AS_064_pending_proposal_renders_a_card_with_visible_diff_and_accept_reject_buttons", () => {
    render(
      <ProposalCard proposal={pendingProposal()} onAccept={vi.fn()} onReject={vi.fn()} />,
    );

    expect(screen.getByTestId("proposal-card")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    expect(screen.getByTestId("diff-row-removed")).toHaveTextContent("old body");
    expect(screen.getByTestId("diff-row-added")).toHaveTextContent("new body");
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("test_AS_069_accept_and_reject_are_real_buttons_with_visible_focus_ring_classes", () => {
    render(
      <ProposalCard proposal={pendingProposal()} onAccept={vi.fn()} onReject={vi.fn()} />,
    );

    const accept = screen.getByTestId("proposal-card-accept");
    const reject = screen.getByTestId("proposal-card-reject");
    expect(accept.tagName).toBe("BUTTON");
    expect(reject.tagName).toBe("BUTTON");
    expect(accept.className).toMatch(/focus-visible:ring/);
    expect(reject.className).toMatch(/focus-visible:ring/);
  });

  it("test_AS_070_no_raw_hex_color_literal_in_this_features_own_source_files", async () => {
    // Scoped to the source THIS feature owns, not the whole rendered DOM
    // — components/ui/button.tsx (pre-existing, outside this feature's
    // Touches) legitimately uses `#ffffff0d`/`#ffffff1a` overlay tints for
    // its own hover states, which is baseline behaviour this feature did
    // not introduce and is not responsible for. F015/F016's OWN files
    // (proposal-card.tsx, diff-view.tsx) must contain zero hex literals —
    // token classes only (bg-status-*, text-status-*, bg-muted, etc).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [
      path.resolve(__dirname, "../proposal-card.tsx"),
      path.resolve(__dirname, "../diff-view.tsx"),
    ];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);
    }
  });

  it("test_AS_065_accept_calls_the_write_path_applies_through_the_editor_and_collapses_to_accepted", async () => {
    const applyAcceptedMarkdown = vi.fn();
    mockGetDocEditorHandle.mockReturnValue({
      getCurrentMarkdown: () => PAYLOAD.currentMarkdown,
      cancelPendingSave: vi.fn(),
      applyAcceptedMarkdown,
    });
    const onAccept = vi.fn();

    render(<ProposalCard proposal={pendingProposal()} onAccept={onAccept} onReject={vi.fn()} />);

    fireEvent.click(screen.getByTestId("proposal-card-accept"));

    await vi.waitFor(() => {
      expect(mockApplyDocEditProposal).toHaveBeenCalledWith({
        docId: "doc-1",
        expectedCurrentMarkdown: PAYLOAD.currentMarkdown,
        proposedMarkdown: PAYLOAD.proposedMarkdown,
      });
    });
    expect(applyAcceptedMarkdown).toHaveBeenCalledWith(PAYLOAD.proposedMarkdown);
    expect(onAccept).toHaveBeenCalledWith("p1");
  });

  it("test_AS_065_accepted_proposal_renders_a_collapsed_single_row_with_no_buttons", () => {
    render(
      <ProposalCard
        proposal={pendingProposal({ status: "accepted" })}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTestId("proposal-card")).toHaveAttribute("data-status", "accepted");
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-card-accept")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-card-reject")).not.toBeInTheDocument();
  });

  it("test_AS_066_reject_performs_zero_calls_and_collapses_to_a_rejected_row", () => {
    const onReject = vi.fn();
    render(<ProposalCard proposal={pendingProposal()} onAccept={vi.fn()} onReject={onReject} />);

    fireEvent.click(screen.getByTestId("proposal-card-reject"));

    expect(onReject).toHaveBeenCalledWith("p1");
    expect(mockApplyDocEditProposal).not.toHaveBeenCalled();
    expect(mockGetDocEditorHandle).not.toHaveBeenCalled();
  });

  it("test_AS_066_rejected_proposal_renders_a_collapsed_single_row_with_no_buttons", () => {
    render(
      <ProposalCard
        proposal={pendingProposal({ status: "rejected" })}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTestId("proposal-card")).toHaveAttribute("data-status", "rejected");
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-card-accept")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-card-reject")).not.toBeInTheDocument();
  });

  it("test_F016_stale_editor_content_blocks_accept_before_any_write_and_shows_a_clear_error", async () => {
    mockGetDocEditorHandle.mockReturnValue({
      getCurrentMarkdown: () => "# Runbook\nSOMEONE ELSE EDITED THIS LIVE IN THE EDITOR",
      cancelPendingSave: vi.fn(),
      applyAcceptedMarkdown: vi.fn(),
    });
    const onAccept = vi.fn();

    render(<ProposalCard proposal={pendingProposal()} onAccept={onAccept} onReject={vi.fn()} />);

    fireEvent.click(screen.getByTestId("proposal-card-accept"));

    await screen.findByTestId("proposal-card-error");
    expect(screen.getByTestId("proposal-card-error")).toHaveTextContent(
      "The document changed since this proposal was made",
    );
    expect(mockApplyDocEditProposal).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
    // Still pending — the user can retry once the assistant regenerates.
    expect(screen.getByTestId("proposal-card")).toHaveAttribute("data-status", "pending");
  });
});
