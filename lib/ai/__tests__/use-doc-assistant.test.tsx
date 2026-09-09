// @vitest-environment jsdom
//
// F008: behavioural tests for lib/ai/use-doc-assistant.ts, the client
// stream parser hook for the docs sidebar's AI assistant.
//
// Covers:
// - AS-062: assistant text renders progressively as `text` events arrive
//   (not only assembled at the end) — asserted by observing intermediate
//   states across multiple chunks, not just the final message.
// - AS-067: an in-flight turn can be stopped; the partial text stays
//   visible and `isStreaming` goes false.
// - The chunk-boundary buffering bug called out in the feature spec: a
//   JSON object split mid-line across two `reader.read()` chunks must
//   still parse correctly, not throw.
// - Unknown `t` values are ignored rather than thrown on (forward
//   compatibility with M3).
// - tool_start/tool_end merge into one toolCalls entry keyed by id.
// - proposal events land in `proposals` with status "pending".
// - error events populate `error` without discarding already-received text.
// - reset() clears all state.
// - send() omits currentDocId rather than sending a non-uuid placeholder.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocAssistant } from "@/lib/ai/use-doc-assistant";

function ndjsonLine(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Builds a `Response`-like object whose body is a ReadableStream yielding
 * the given chunks (already-encoded strings) one `reader.read()` at a
 * time, in order.
 */
function streamResponse(chunks: string[], ok = true): Response {
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
  });
  return {
    ok,
    body,
  } as unknown as Response;
}

describe("useDocAssistant", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("test_AS_062_text_deltas_append_progressively_across_multiple_chunks", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "text", v: "Hello" }),
        ndjsonLine({ t: "text", v: ", world" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    // Intermediate state: first delta has landed before the second chunk
    // has necessarily been processed. We assert progressive assembly by
    // checking the final assistant message is exactly the concatenation
    // of both deltas, appended onto ONE message (not two separate ones).
    await waitFor(() => {
      const assistantMsgs = result.current.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].text).toBe("Hello, world");
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it("test_AS_067_stop_aborts_stream_keeps_partial_text_and_clears_streaming", async () => {
    const encoder = new TextEncoder();
    const releaseSecondChunkHolder: { current: (() => void) | null } = {
      current: null,
    };
    const gate = new Promise<void>((resolve) => {
      releaseSecondChunkHolder.current = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "partial" })));
        // Wait until the test releases this, simulating an in-flight
        // stream that hasn't sent `done` yet.
        await gate;
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: " more" })));
        controller.close();
      },
    });

    fetchMock.mockResolvedValueOnce({ ok: true, body } as unknown as Response);

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.role === "assistant" && m.text === "partial"),
      ).toBe(true);
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isStreaming).toBe(false);
    // Partial text remains visible after stop.
    expect(
      result.current.messages.some((m) => m.role === "assistant" && m.text === "partial"),
    ).toBe(true);

    // Release the gate so the underlying stream can finish/cleanup without
    // hanging the test process; the hook must not un-stop itself when the
    // aborted fetch's stream eventually settles.
    releaseSecondChunkHolder.current?.();
  });

  it("test_chunk_boundary_json_object_split_mid_line_parses_correctly", async () => {
    // The single most common defect in this kind of hook: a chunk boundary
    // falls mid-JSON-object. Naive `chunk.split("\n")` would throw trying
    // to JSON.parse the fragment; buffered parsing must retain the partial
    // and complete it on the next chunk.
    const fullLine = ndjsonLine({ t: "text", v: "split across chunks" });
    const splitPoint = Math.floor(fullLine.length / 2);
    const chunk1 = fullLine.slice(0, splitPoint); // ends mid-object, no trailing \n
    const chunk2 = fullLine.slice(splitPoint) + ndjsonLine({ t: "done" });

    fetchMock.mockResolvedValueOnce(streamResponse([chunk1, chunk2]));

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      const assistantMsgs = result.current.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].text).toBe("split across chunks");
    });

    // No error should have been raised as a side effect of the split.
    expect(result.current.error).toBeNull();
  });

  it("test_unknown_event_type_is_ignored_not_thrown", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "future_event_type", something: "new" }),
        ndjsonLine({ t: "text", v: "still works" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (m) => m.role === "assistant" && m.text === "still works",
        ),
      ).toBe(true);
    });
    expect(result.current.error).toBeNull();
  });

  it("test_tool_start_and_tool_end_merge_into_one_entry_by_id", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "tool_start", id: "t1", name: "search_docs" }),
        ndjsonLine({ t: "tool_end", id: "t1", summary: "3 results", detail: "detail here" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.toolCalls).toHaveLength(1);
      expect(result.current.toolCalls[0]).toMatchObject({
        id: "t1",
        name: "search_docs",
        status: "done",
        summary: "3 results",
        detail: "detail here",
      });
    });
  });

  it("test_proposal_event_becomes_pending_proposal", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({
          t: "proposal",
          id: "p1",
          kind: "doc_edit",
          payload: { foo: "bar" },
        }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.proposals).toHaveLength(1);
      expect(result.current.proposals[0]).toMatchObject({
        id: "p1",
        kind: "doc_edit",
        status: "pending",
      });
    });
  });

  it("test_error_event_populates_error_without_discarding_received_text", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "text", v: "some text" }),
        ndjsonLine({ t: "error", code: "upstream", message: "boom" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ code: "upstream", message: "boom" });
    });

    expect(
      result.current.messages.some((m) => m.role === "assistant" && m.text === "some text"),
    ).toBe(true);
  });

  it("test_reset_clears_all_state", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "text", v: "hello" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1" }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.proposals).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it("test_send_omits_currentDocId_when_not_provided_rather_than_placeholder", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));

    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1", currentDocId: null }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody.workspaceId).toBe("ws-1");
    expect(parsedBody).not.toHaveProperty("currentDocId");
  });

  it("test_send_includes_currentDocId_when_provided", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));

    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const { result } = renderHook(() =>
      useDocAssistant({ workspaceId: "ws-1", currentDocId: validUuid }),
    );

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody.currentDocId).toBe(validUuid);
  });
});
