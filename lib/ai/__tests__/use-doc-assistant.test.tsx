// @vitest-environment jsdom
//
// F008/F034: behavioural tests for lib/ai/use-doc-assistant.ts, the client
// stream parser hook for the docs sidebar's AI assistant.
//
// Covers:
// - AS-062: assistant text renders progressively as `text` events arrive —
//   asserted via a genuine *intermediate* state (a gated second chunk),
//   not just the final concatenation. A hook that buffers everything and
//   flushes once at `done` must fail this test.
// - AS-067: stop() actually aborts the in-flight controller (asserted via
//   `signal.aborted`), and a further scheduled chunk that arrives after
//   stop() must NOT grow the text. A cosmetic `setIsStreaming(false)` with
//   no real abort() must fail this test.
// - AS-047: a second send() includes the first turn's history in the
//   request body, mapped to `historyTurnSchema` shape.
// - AS-041: tool_start after tool_end does not regress a finished call
//   back to "running".
// - unmount mid-stream stops event application (no act() warnings, no
//   further state writes).
// - reset() mid-stream: a chunk that resolves after reset() must not
//   repopulate the cleared conversation.
// - a final line with no trailing newline is still parsed.
// - malformed JSON in a line is ignored, not thrown.
// - non-2xx responses surface the server's real message.
// - double submit: the first turn's stream is aborted by the second send().
// - tool_start/tool_end in both orderings merge into one entry.
// - the chunk-boundary buffering bug: a JSON object split mid-line across
//   two `reader.read()` chunks must still parse correctly.
// - unknown `t` values are ignored rather than thrown on.
// - send() omits currentDocId rather than sending a non-uuid placeholder.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
function streamResponse(chunks: string[], ok = true, status = 200): Response {
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
      // no-op — allows reader.cancel() to resolve.
    },
  });
  return {
    ok,
    status,
    body,
  } as unknown as Response;
}

/**
 * F037: like `streamResponse`, but yields raw pre-encoded byte chunks
 * instead of whole strings — needed to reproduce a multibyte UTF-8
 * character's bytes being split across two `reader.read()` chunks, which
 * is impossible to construct by encoding separate strings (each string
 * chunk always encodes to a complete, self-contained byte sequence).
 */
function rawByteStreamResponse(chunks: Uint8Array[]): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      // no-op — allows reader.cancel() to resolve.
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

/** A non-2xx JSON error response with no stream body, like the route emits. */
function errorResponse(status: number, errorMessage: string): Response {
  return {
    ok: false,
    status,
    body: null,
    json: async () => ({ error: errorMessage }),
  } as unknown as Response;
}

describe("useDocAssistant", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("test_AS_062_text_renders_progressively_intermediate_state_before_final", async () => {
    const encoder = new TextEncoder();
    const releaseSecondChunkHolder: { current: (() => void) | null } = {
      current: null,
    };
    const gate = new Promise<void>((resolve) => {
      releaseSecondChunkHolder.current = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "Hello" })));
        await gate;
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: ", world" })));
        controller.enqueue(encoder.encode(ndjsonLine({ t: "done" })));
        controller.close();
      },
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body } as unknown as Response);

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    // Genuine intermediate state: the first chunk has landed but the
    // second is still gated behind the promise above. If the hook buffers
    // everything and flushes once at `done`, this assertion never becomes
    // true and the test times out / fails.
    await waitFor(() => {
      const assistantMsgs = result.current.messages.filter((m) => m.role === "assistant");
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].text).toBe("Hello");
    });
    expect(result.current.isStreaming).toBe(true);

    releaseSecondChunkHolder.current?.();

    await waitFor(() => {
      const assistantMsgs = result.current.messages.filter((m) => m.role === "assistant");
      expect(assistantMsgs[0].text).toBe("Hello, world");
    });
    expect(result.current.isStreaming).toBe(false);
  });

  it("test_AS_067_stop_aborts_the_controller_and_a_later_chunk_does_not_grow_text", async () => {
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
        await gate;
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: " MORE-AFTER-STOP" })));
        controller.close();
      },
      cancel() {},
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body } as unknown as Response);

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

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
    expect(
      result.current.messages.some((m) => m.role === "assistant" && m.text === "partial"),
    ).toBe(true);

    // Release the gated second chunk — a real abort() must prevent it
    // from ever being applied. A hook that only sets isStreaming(false)
    // cosmetically (without abort()) would let this grow the text.
    await act(async () => {
      releaseSecondChunkHolder.current?.();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(
      result.current.messages.some(
        (m) => m.role === "assistant" && m.text.includes("MORE-AFTER-STOP"),
      ),
    ).toBe(false);
    expect(
      result.current.messages.find((m) => m.role === "assistant")?.text,
    ).toBe("partial");
  });

  it("test_AS_067_stop_sets_the_real_abort_signal_aborted", async () => {
    const encoder = new TextEncoder();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      let enqueued = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (enqueued) return new Promise<void>(() => {});
          enqueued = true;
          controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "x" })));
        },
      });
      return Promise.resolve({ ok: true, status: 200, body } as unknown as Response);
    });

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => {
      result.current.stop();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("test_AS_047_second_send_includes_first_turn_in_request_body_history", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([ndjsonLine({ t: "text", v: "first reply" }), ndjsonLine({ t: "done" })]),
    );
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("first message");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.role === "assistant" && m.text === "first reply"),
      ).toBe(true);
    });
    expect(result.current.isStreaming).toBe(false);

    act(() => {
      result.current.send("second message");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [, secondInit] = fetchMock.mock.calls[1];
    const parsedBody = JSON.parse((secondInit as RequestInit).body as string);
    expect(parsedBody.message).toBe("second message");
    expect(parsedBody.messages).toEqual([
      { role: "user", content: "first message" },
      { role: "assistant", content: "first reply" },
    ]);
  });

  it("test_first_send_omits_messages_field_when_history_empty", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody).not.toHaveProperty("messages");
  });

  it("test_AS_041_tool_start_after_tool_end_does_not_regress_finished_call", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "tool_start", id: "t1", name: "search_docs" }),
        ndjsonLine({ t: "tool_end", id: "t1", summary: "3 results" }),
        // Out-of-order: a stray tool_start for the same id arrives after
        // its own tool_end. Must not flip status back to "running".
        ndjsonLine({ t: "tool_start", id: "t1", name: "search_docs" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.toolCalls).toHaveLength(1);
      expect(result.current.toolCalls[0].status).toBe("done");
    });

    expect(result.current.isStreaming).toBe(false);
    // Give any stray microtask a chance to run, then re-assert it's still done.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.toolCalls[0].status).toBe("done");
  });

  it("test_tool_start_then_tool_end_normal_ordering_merges_into_one_entry", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "tool_start", id: "t1", name: "search_docs" }),
        ndjsonLine({ t: "tool_end", id: "t1", summary: "3 results", detail: "detail here" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

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

  it("test_tool_end_before_tool_start_still_records_it_as_done", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "tool_end", id: "t2", summary: "result" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.toolCalls).toHaveLength(1);
      expect(result.current.toolCalls[0]).toMatchObject({ id: "t2", status: "done" });
    });
  });

  it("test_unmount_mid_stream_aborts_the_in_flight_controller", async () => {
    // React discards post-unmount setState calls regardless of whether
    // this hook cleans up — so asserting on `messages` after unmount
    // would pass even with no cleanup at all (a false-positive risk this
    // spec explicitly calls out). The real, mutation-visible behaviour is
    // that the underlying request is actually torn down (so the model
    // stops generating/billing for a response nobody can render): assert
    // the fetch's own AbortSignal is aborted once the component unmounts.
    const encoder = new TextEncoder();
    let capturedSignal: AbortSignal | undefined;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "before-unmount" })));
        // Never resolves on its own — this stream only ever ends via the
        // abort-triggered error() below, mirroring how a real fetch tears
        // its response body down when the request's AbortController fires.
        return new Promise<void>(() => {});
      },
    });

    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      capturedSignal.addEventListener("abort", () => {
        streamController?.error(new DOMException("The operation was aborted.", "AbortError"));
      });
      return Promise.resolve({ ok: true, status: 200, body } as unknown as Response);
    });

    const { result, unmount } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.text === "before-unmount"),
      ).toBe(true);
    });

    unmount();

    await new Promise((r) => setTimeout(r, 20));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("test_reset_mid_stream_a_later_chunk_does_not_repopulate_the_conversation", async () => {
    const encoder = new TextEncoder();
    const releaseSecondChunkHolder: { current: (() => void) | null } = {
      current: null,
    };
    const gate = new Promise<void>((resolve) => {
      releaseSecondChunkHolder.current = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "will-be-cleared" })));
        await gate;
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: " resurrected" })));
        controller.close();
      },
      cancel() {},
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body } as unknown as Response);

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.text === "will-be-cleared"),
      ).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);

    await act(async () => {
      releaseSecondChunkHolder.current?.();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.messages).toEqual([]);
  });

  it("F037: the stream's TextDecoder is explicitly flushed (decode() with no args) once the stream ends", async () => {
    // A genuinely truncated trailing multibyte character (its completing
    // bytes never sent at all — the true "split across the last chunk"
    // shape the fix targets) also can't form valid trailing JSON either
    // way, so it isn't independently observable through `messages` alone
    // — see this test's comment history / the F037 handoff for the full
    // reasoning. What IS directly, reliably observable (and what a
    // regression that deletes the trailing flush call breaks) is that
    // `TextDecoder.prototype.decode` gets one final call with NO
    // arguments after the read loop ends, forcing out whatever partial
    // sequence the decoder is internally holding rather than leaving it
    // silently stuck forever.
    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");

    fetchMock.mockResolvedValueOnce(
      streamResponse([ndjsonLine({ t: "text", v: "hello" }), ndjsonLine({ t: "done" })]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(decodeSpy).toHaveBeenCalled();
    const finalCallArgs = decodeSpy.mock.calls.at(-1);
    // The trailing flush call is `decoder.decode()` — zero arguments,
    // distinct from every in-loop call, which is always
    // `decoder.decode(value, { stream: true })`.
    expect(finalCallArgs).toEqual([]);

    decodeSpy.mockRestore();
  });

  it("F037: a multibyte character that straddles two stream chunks (not truncated) still renders correctly end-to-end", async () => {
    // "€" is 3 UTF-8 bytes (E2 82 AC). Splits it across two genuine
    // `reader.read()` chunks — both consumed inside the read loop before
    // `done` — covering the (already-correct, unrelated-to-the-flush-fix)
    // ordinary cross-chunk case, so this feature doesn't regress it while
    // fixing the true end-of-stream truncation case above.
    const line = JSON.stringify({ t: "text", v: "price: €" }) + "\n" + ndjsonLine({ t: "done" });
    const fullBytes = new TextEncoder().encode(line);
    const euroStart = line.indexOf("€");
    const splitAt = new TextEncoder().encode(line.slice(0, euroStart)).length + 2; // mid "€"
    const firstChunk = fullBytes.slice(0, splitAt);
    const secondChunk = fullBytes.slice(splitAt);

    fetchMock.mockResolvedValueOnce(rawByteStreamResponse([firstChunk, secondChunk]));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.messages.at(-1)?.text).toBe("price: €");
  });

  it("test_final_line_with_no_trailing_newline_is_still_parsed", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([JSON.stringify({ t: "text", v: "no newline at end" })]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (m) => m.role === "assistant" && m.text === "no newline at end",
        ),
      ).toBe(true);
    });
  });

  it("test_malformed_json_line_is_ignored_not_thrown", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        "{not valid json\n",
        ndjsonLine({ t: "text", v: "still works" }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.role === "assistant" && m.text === "still works"),
      ).toBe(true);
    });
    expect(result.current.error).toBeNull();
  });

  it("test_non_2xx_response_surfaces_the_servers_real_message_401", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, "Unauthorized."));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ code: "http_401", message: "Unauthorized." });
    });
    expect(result.current.isStreaming).toBe(false);
  });

  it("test_non_2xx_response_surfaces_distinct_message_for_403_vs_401", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, "You don't have access to that workspace."));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({
        code: "http_403",
        message: "You don't have access to that workspace.",
      });
    });
  });

  it("test_double_submit_aborts_the_first_turns_stream", async () => {
    const encoder = new TextEncoder();
    let firstControllerSignal: AbortSignal | undefined;

    let firstBodyEnqueued = false;
    const firstBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (firstBodyEnqueued) {
          // Nothing further to give without hanging forever — the reader
          // is expected to stop pulling once the controller is aborted.
          return new Promise<void>(() => {});
        }
        firstBodyEnqueued = true;
        controller.enqueue(encoder.encode(ndjsonLine({ t: "text", v: "first-turn-text" })));
        // Never closes on its own — relies on abort.
      },
      cancel() {},
    });

    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      firstControllerSignal = init.signal as AbortSignal;
      return Promise.resolve({ ok: true, status: 200, body: firstBody } as unknown as Response);
    });
    fetchMock.mockResolvedValueOnce(streamResponse([ndjsonLine({ t: "done" })]));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("first");
    });

    await waitFor(() => expect(firstControllerSignal).toBeDefined());

    act(() => {
      result.current.send("second");
    });

    await waitFor(() => {
      expect(firstControllerSignal?.aborted).toBe(true);
    });
  });

  it("test_chunk_boundary_json_object_split_mid_line_parses_correctly", async () => {
    const fullLine = ndjsonLine({ t: "text", v: "split across chunks" });
    const splitPoint = Math.floor(fullLine.length / 2);
    const chunk1 = fullLine.slice(0, splitPoint);
    const chunk2 = fullLine.slice(splitPoint) + ndjsonLine({ t: "done" });

    fetchMock.mockResolvedValueOnce(streamResponse([chunk1, chunk2]));

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      const assistantMsgs = result.current.messages.filter((m) => m.role === "assistant");
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].text).toBe("split across chunks");
    });
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

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => {
      expect(
        result.current.messages.some((m) => m.role === "assistant" && m.text === "still works"),
      ).toBe(true);
    });
    expect(result.current.error).toBeNull();
  });

  it("test_proposal_event_becomes_pending_proposal", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        ndjsonLine({ t: "proposal", id: "p1", kind: "doc_edit", payload: { foo: "bar" } }),
        ndjsonLine({ t: "done" }),
      ]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

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

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

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
      streamResponse([ndjsonLine({ t: "text", v: "hello" }), ndjsonLine({ t: "done" })]),
    );

    const { result } = renderHook(() => useDocAssistant({ workspaceId: "ws-1" }));

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
