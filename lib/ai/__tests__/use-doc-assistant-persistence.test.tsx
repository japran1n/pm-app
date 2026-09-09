// @vitest-environment jsdom
//
// F019: behavioural tests for thread persistence in
// lib/ai/use-doc-assistant.ts. Covers:
//
// - AS-082: reloading the page (a fresh mount) restores the current
//   thread's messages in order — asserted via a mocked `getRecentThread`
//   the hook must call on mount and hydrate from.
// - the matching empty-load case: `getRecentThread` resolving to `null`
//   (a workspace with no prior threads) leaves the hook in its ordinary
//   fresh-start state.
// - AS-083: "New chat" (`reset()`) starts a new thread — the NEXT send()
//   calls `createThread` again rather than reusing the old thread id.
// - AS-084: sending a message persists the user turn immediately (before
//   the stream resolves), and the assistant turn (with tool calls and
//   proposals) once the stream reaches `done`.
// - AS-085: accepting/rejecting a proposal calls `updateProposalState` so
//   the settled state persists — and a proposal hydrated already
//   `accepted` never re-arms Accept (this hook has no notion of "already
//   decided this session" separate from the hydrated `status` itself, so
//   this is asserted via hydration producing a non-"pending" status that
//   acceptProposal/rejectProposal's own one-time guard then respects).

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createThreadMock = vi.fn();
const addMessageMock = vi.fn();
const getRecentThreadMock = vi.fn();
const updateProposalStateMock = vi.fn();

vi.mock("@/lib/actions/ai-threads", () => ({
  createThread: (...args: unknown[]) => createThreadMock(...args),
  addMessage: (...args: unknown[]) => addMessageMock(...args),
  getRecentThread: (...args: unknown[]) => getRecentThreadMock(...args),
  getThread: vi.fn().mockResolvedValue(null),
  updateProposalState: (...args: unknown[]) => updateProposalStateMock(...args),
}));

import { useDocAssistant } from "@/lib/ai/use-doc-assistant";
import { logger } from "@/lib/observability/logger";

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
    cancel() {},
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

describe("useDocAssistant persistence (F019)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    createThreadMock.mockReset();
    addMessageMock.mockReset();
    getRecentThreadMock.mockReset();
    updateProposalStateMock.mockReset();

    createThreadMock.mockResolvedValue({ id: "thread-1" });
    addMessageMock.mockResolvedValue({ id: "message-1" });
    getRecentThreadMock.mockResolvedValue(null);
    updateProposalStateMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("test_AS_082_mount_loads_the_most_recent_thread_and_restores_messages_in_order", async () => {
    getRecentThreadMock.mockResolvedValue({
      id: "thread-99",
      workspaceId: "ws-1",
      docId: null,
      projectId: null,
      title: "old convo",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:05:00Z",
      messages: [
        { id: "m1", threadId: "thread-99", role: "user", content: "hi", toolCalls: null, proposals: null, usage: null, createdAt: "2026-01-01T00:00:00Z" },
        { id: "m2", threadId: "thread-99", role: "assistant", content: "hello back", toolCalls: null, proposals: null, usage: null, createdAt: "2026-01-01T00:01:00Z" },
      ],
    });

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    await waitFor(() => {
      expect(getRecentThreadMock).toHaveBeenCalledWith("ws-1");
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { id: "m1", role: "user", text: "hi" },
        { id: "m2", role: "assistant", text: "hello back" },
      ]);
    });
  });

  it("test_empty_load_getRecentThread_null_leaves_a_fresh_start", async () => {
    getRecentThreadMock.mockResolvedValue(null);

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    await waitFor(() => {
      expect(getRecentThreadMock).toHaveBeenCalledWith("ws-1");
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.proposals).toEqual([]);
    expect(result.current.toolCalls).toEqual([]);
  });

  it("test_AS_084_send_persists_the_user_turn_immediately_before_the_stream_resolves", async () => {
    let releaseStream!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await gate;
        controller.enqueue(new TextEncoder().encode(ndjsonLine({ t: "done" })));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body } as unknown as Response);

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    await waitFor(() => expect(getRecentThreadMock).toHaveBeenCalled());

    act(() => {
      result.current.send("hello there");
    });

    // The user turn is persisted BEFORE the stream ever resolves — asserted
    // while the stream is still gated.
    await waitFor(() => {
      expect(createThreadMock).toHaveBeenCalledWith("ws-1", null, null, "hello there");
    });
    await waitFor(() => {
      expect(addMessageMock).toHaveBeenCalledWith("thread-1", "user", "hello there", null, null, null);
    });

    releaseStream();
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("test_AS_084_assistant_turn_persists_with_tool_calls_and_proposals_on_done", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "text", v: "here is the plan" }),
        ndjsonLine({ t: "tool_start", id: "t1", name: "search_docs" }),
        ndjsonLine({ t: "tool_end", id: "t1", summary: "3 results" }),
        ndjsonLine({
          t: "proposal",
          id: "p1",
          kind: "doc_edit",
          payload: { kind: "doc_edit", docId: "doc-1" },
        }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));
    await waitFor(() => expect(getRecentThreadMock).toHaveBeenCalled());

    act(() => {
      result.current.send("plan something");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    await waitFor(() => {
      const assistantCall = addMessageMock.mock.calls.find((call) => call[1] === "assistant");
      expect(assistantCall).toBeDefined();
    });

    const assistantCall = addMessageMock.mock.calls.find((call) => call[1] === "assistant")!;
    const [threadId, role, content, toolCalls, proposals] = assistantCall;
    expect(threadId).toBe("thread-1");
    expect(role).toBe("assistant");
    expect(content).toBe("here is the plan");
    expect(toolCalls).toEqual([
      { id: "t1", name: "search_docs", status: "done", summary: "3 results", detail: undefined },
    ]);
    expect(proposals).toEqual([
      {
        id: "p1",
        kind: "doc_edit",
        payload: { kind: "doc_edit", docId: "doc-1" },
        status: "pending",
      },
    ]);
  });

  it("test_abort_still_persists_the_partial_assistant_content", async () => {
    // Wires the AbortController's signal to actually tear down the
    // stream — same shape the F034 "unmount mid stream" test in
    // use-doc-assistant.test.tsx uses to reproduce how a REAL fetch's
    // reader.read() rejects once its request is aborted (a plain
    // ReadableStream mock does not do this on its own).
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(ndjsonLine({ t: "text", v: "partial answer" })));
        return new Promise<void>(() => {});
      },
    });
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener("abort", () => {
        streamController?.error(new DOMException("The operation was aborted.", "AbortError"));
      });
      return Promise.resolve({ ok: true, status: 200, body } as unknown as Response);
    });

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));
    await waitFor(() => expect(getRecentThreadMock).toHaveBeenCalled());

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.role === "assistant" && m.text === "partial answer"),
      ).toBe(true);
    });

    act(() => {
      result.current.stop();
    });

    await waitFor(() => {
      const assistantCall = addMessageMock.mock.calls.find((call) => call[1] === "assistant");
      expect(assistantCall).toBeDefined();
    });

    const assistantCall = addMessageMock.mock.calls.find((call) => call[1] === "assistant")!;
    expect(assistantCall[2]).toBe("partial answer");
  });

  it("test_AS_083_new_chat_reset_makes_the_next_send_create_a_new_thread", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));
    createThreadMock
      .mockResolvedValueOnce({ id: "thread-a" })
      .mockResolvedValueOnce({ id: "thread-b" });

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));
    await waitFor(() => expect(getRecentThreadMock).toHaveBeenCalled());

    act(() => {
      result.current.send("first conversation");
    });
    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    act(() => {
      result.current.reset();
    });
    expect(result.current.messages).toEqual([]);

    act(() => {
      result.current.send("second conversation, new chat");
    });

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(2));
    expect(createThreadMock.mock.calls[1]).toEqual([
      "ws-1",
      null,
      null,
      "second conversation, new chat",
    ]);
    // The old thread was never deleted or touched again — createThread was
    // called again (a genuinely NEW row), not some "reuse/undelete" call.
    expect(addMessageMock.mock.calls.some((call) => call[0] === "thread-a")).toBe(true);
  });

  it("test_AS_085_accepting_a_proposal_persists_its_settled_state", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "proposal", id: "p1", kind: "doc_edit", payload: { foo: "bar" } }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));
    await waitFor(() => expect(getRecentThreadMock).toHaveBeenCalled());

    act(() => {
      result.current.send("edit the doc");
    });

    await waitFor(() => expect(result.current.proposals).toHaveLength(1));
    await waitFor(() => {
      const assistantCall = addMessageMock.mock.calls.find((call) => call[1] === "assistant");
      expect(assistantCall).toBeDefined();
    });
    // The assistant-turn `addMessage` call above only confirms the call was
    // MADE — populating `proposalLocationRef` (what makes
    // `updateProposalState` callable at all) happens in that call's own
    // `.then`, one further microtask turn out. Flushing a couple of
    // microtask turns here is the same "let already-scheduled promise
    // continuations run" idiom used throughout this codebase's tests
    // (e.g. the F034 abort tests' `await new Promise((r) =>
    // setTimeout(r, ...))`), not a fixed real-world delay.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      result.current.acceptProposal("p1");
    });

    expect(result.current.proposals[0].status).toBe("accepted");
    await waitFor(() => {
      expect(updateProposalStateMock).toHaveBeenCalledWith("thread-1", "message-1", "p1", "accepted");
    });
  });

  it("test_AS_085_a_hydrated_accepted_proposal_never_re_arms_accept", async () => {
    getRecentThreadMock.mockResolvedValue({
      id: "thread-99",
      workspaceId: "ws-1",
      docId: null,
      projectId: null,
      title: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:05:00Z",
      messages: [
        {
          id: "m2",
          threadId: "thread-99",
          role: "assistant",
          content: "done",
          toolCalls: null,
          proposals: [
            { id: "p1", kind: "doc_edit", payload: { foo: "bar" }, status: "accepted" },
          ],
          usage: null,
          createdAt: "2026-01-01T00:01:00Z",
        },
      ],
    });

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    await waitFor(() => {
      expect(result.current.proposals).toEqual([
        { id: "p1", kind: "doc_edit", payload: { foo: "bar" }, status: "accepted" },
      ]);
    });

    // The one-time guard inside acceptProposal/rejectProposal keys off
    // `status !== "pending"` — a hydrated non-pending proposal is already
    // immune, exactly like a same-session settled one.
    act(() => {
      result.current.acceptProposal("p1");
    });
    expect(result.current.proposals[0].status).toBe("accepted");
    expect(updateProposalStateMock).not.toHaveBeenCalled();

    act(() => {
      result.current.rejectProposal("p1");
    });
    expect(result.current.proposals[0].status).toBe("accepted");
  });
});
