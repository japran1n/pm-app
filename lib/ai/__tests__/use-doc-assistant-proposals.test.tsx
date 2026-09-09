// @vitest-environment jsdom
//
// F015: behavioural tests for `acceptProposal`/`rejectProposal` on
// `useDocAssistant` (lib/ai/use-doc-assistant.ts). These two functions
// perform NO writes themselves — see components/ai/proposal-card.tsx and
// lib/actions/ai-proposals.ts for the actual write path (F016) — they are
// pure in-memory state transitions. This file drives a real "proposal"
// NDJSON event through the hook's own stream parser (the only way a
// proposal enters `proposals` in production) and then exercises
// accept/reject against it, including the one-time invariant: once a
// proposal has moved off "pending", neither function may move it again.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocAssistant } from "@/lib/ai/use-doc-assistant";

function ndjsonLine(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
    cancel() {
      // no-op
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const PROPOSAL_PAYLOAD = {
  kind: "doc_edit",
  proposalId: "p1",
  docId: "doc-1",
  docTitle: "Runbook",
  currentMarkdown: "# Runbook\nold",
  proposedMarkdown: "# Runbook\nnew",
  summary: 'Proposed edit to "Runbook".',
  diff: [
    { type: "removed", value: "old\n" },
    { type: "added", value: "new\n" },
  ],
};

describe("useDocAssistant proposal accept/reject", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function sendAndReceiveProposal() {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "proposal", id: "p1", kind: "doc_edit", payload: PROPOSAL_PAYLOAD }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "w1" }));

    act(() => {
      result.current.send("edit the doc");
    });

    await waitFor(() => {
      expect(result.current.proposals).toHaveLength(1);
    });

    return result;
  }

  it("test_AS_065_acceptProposal_transitions_the_matching_pending_proposal_to_accepted", async () => {
    const result = await sendAndReceiveProposal();

    expect(result.current.proposals[0].status).toBe("pending");

    act(() => {
      result.current.acceptProposal("p1");
    });

    expect(result.current.proposals[0].status).toBe("accepted");
  });

  it("test_AS_066_rejectProposal_transitions_the_matching_pending_proposal_to_rejected", async () => {
    const result = await sendAndReceiveProposal();

    act(() => {
      result.current.rejectProposal("p1");
    });

    expect(result.current.proposals[0].status).toBe("rejected");
  });

  it("test_F015_a_settled_proposal_can_never_be_re_decided", async () => {
    const result = await sendAndReceiveProposal();

    act(() => {
      result.current.acceptProposal("p1");
    });
    expect(result.current.proposals[0].status).toBe("accepted");

    // Attempting reject after accept must NOT move it to rejected — the
    // one-time guard keys off `status !== "pending"`, not off which
    // function is called second.
    act(() => {
      result.current.rejectProposal("p1");
    });
    expect(result.current.proposals[0].status).toBe("accepted");
  });

  it("test_F015_accept_reject_are_safe_noops_for_an_unknown_proposal_id", async () => {
    const { result } = renderHook(() => useDocAssistant({ workspaceId: "w1" }));

    act(() => {
      result.current.acceptProposal("nonexistent-id");
      result.current.rejectProposal("nonexistent-id");
    });

    expect(result.current.proposals).toEqual([]);
  });
});
