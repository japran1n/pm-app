// F007 (AS-007, AS-040, AS-041, AS-042, AS-043, AS-044, AS-045, AS-046,
// AS-048, AS-105): contract tests for app/api/ai/docs/route.ts — the one
// HTTP entry point for the docs sidebar AI assistant.
//
// Everything the route touches on the network boundary is stubbed:
//   - lib/supabase/server's createClient() (auth.getUser())
//   - lib/ai/client's hasApiKey()/getAnthropicClient()
//   - lib/ai/docs-agent's buildDocsAgentRequest()
//   - the Anthropic client's `beta.messages.stream()` call itself, via a
//     scripted fake that supports `.on("text", cb)` and `.finalMessage()`,
//     the exact surface the route uses.
//
// No real network call, no real Supabase project, no real Anthropic call —
// safe to run directly with `npx vitest run tests/integration/
// f007-docs-agent-route.test.ts` (not part of `npm test`'s live-Supabase
// suite; this file mocks the Supabase seam entirely).

import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

const hasApiKeyMock = vi.fn();
const streamMock = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  hasApiKey: hasApiKeyMock,
  getAnthropicClient: vi.fn(() => ({
    beta: { messages: { stream: streamMock } },
  })),
}));

const buildDocsAgentRequestMock = vi.fn();
vi.mock("@/lib/ai/docs-agent", () => ({
  buildDocsAgentRequest: buildDocsAgentRequestMock,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks are registered.
const { POST } = await import("@/app/api/ai/docs/route");
const { RateLimitError, APIError } = await import("@anthropic-ai/sdk");

const AUTHED_USER = { id: "user-1" };

function makeRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/ai/docs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

/** Reads the whole NDJSON stream and returns the parsed event list. */
async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  const lines = text.split("\n").filter((l) => l.length > 0);
  return lines.map((line) => {
    // AS-041: every emitted line must be a single valid JSON object.
    return JSON.parse(line) as Record<string, unknown>;
  });
}

function baseAgentRequest(tools: unknown[] = []) {
  return {
    model: "claude-opus-5",
    max_tokens: 16000,
    system: [{ type: "text", text: "system" }],
    messages: [{ role: "user", content: "hi" }],
    tools,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    stream: true,
  };
}

/** A scripted fake for `client.beta.messages.stream(...)`. */
function fakeAnthropicStream(finalMessage: unknown, textDeltas: string[] = []) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] ??= [];
      listeners[event].push(cb);
      return this;
    },
    async finalMessage() {
      for (const delta of textDeltas) {
        for (const cb of listeners.text ?? []) cb(delta);
      }
      if (finalMessage instanceof Error) throw finalMessage;
      return finalMessage;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: AUTHED_USER } });
  hasApiKeyMock.mockReturnValue(true);
  buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest());
});

describe("test_AS_007_unauthenticated_request_gets_401_before_any_model_call", () => {
  it("returns 401 and never constructs a model request", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await POST(makeRequest({ message: "hello" }));

    expect(response.status).toBe(401);
    expect(buildDocsAgentRequestMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("test_AS_045_no_api_key_opens_stream_with_error_then_done_at_http_200", () => {
  it("never returns a 500 and never calls the model", async () => {
    hasApiKeyMock.mockReturnValue(false);

    const response = await POST(makeRequest({ message: "hello" }));
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    expect(events).toEqual([
      { t: "error", code: "no_api_key", message: expect.any(String) },
      { t: "done" },
    ]);
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("test_AS_040_ndjson_envelope_matches_the_contract_shape", () => {
  it("emits text then usage then done for a plain text turn", async () => {
    streamMock.mockReturnValue(
      fakeAnthropicStream(
        {
          content: [{ type: "text", text: "Hello there" }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
        },
        ["Hello", " there"],
      ),
    );

    const response = await POST(makeRequest({ message: "hi" }));
    const events = await readEvents(response);

    expect(events).toEqual([
      { t: "text", v: "Hello" },
      { t: "text", v: " there" },
      { t: "usage", in: 10, out: 5, cached: 3 },
      { t: "done" },
    ]);
  });
});

describe("test_AS_041_every_line_is_exactly_one_valid_json_object", () => {
  it("parses every non-empty line as a standalone JSON object", async () => {
    streamMock.mockReturnValue(
      fakeAnthropicStream({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }),
    );

    const response = await POST(makeRequest({ message: "hi" }));
    const text = await response.text();
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(typeof JSON.parse(line).t).toBe("string");
    }
  });
});

describe("test_AS_042_tool_end_always_pairs_with_tool_start_even_on_throw", () => {
  it("emits a matching tool_end with an error summary when the tool throws", async () => {
    const throwingTool = {
      name: "search_docs",
      parse: (x: unknown) => x,
      run: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest([throwingTool]));

    streamMock
      .mockReturnValueOnce(
        fakeAnthropicStream({
          content: [
            { type: "tool_use", id: "tool-1", name: "search_docs", input: { query: "x" } },
          ],
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
          stop_reason: "tool_use",
        }),
      )
      .mockReturnValueOnce(
        fakeAnthropicStream({
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 2, output_tokens: 2, cache_read_input_tokens: 0 },
        }),
      );

    const response = await POST(makeRequest({ message: "search for x" }));
    const events = await readEvents(response);

    const toolStart = events.find((e) => e.t === "tool_start");
    const toolEnd = events.find((e) => e.t === "tool_end");

    expect(toolStart).toEqual({ t: "tool_start", id: "tool-1", name: "search_docs" });
    expect(toolEnd).toMatchObject({ t: "tool_end", id: "tool-1", summary: "tool error" });
    // The loop must continue (a second model call happens) rather than crash the request.
    expect(streamMock).toHaveBeenCalledTimes(2);
  });
});

describe("test_AS_043_a_proposal_result_ends_the_turn_immediately", () => {
  it("emits proposal and does not let the model continue as though it applied", async () => {
    const proposalTool = {
      name: "propose_doc_edit",
      parse: (x: unknown) => x,
      run: vi.fn(async () =>
        JSON.stringify({
          status: "ok",
          data: {
            kind: "doc_edit",
            proposalId: "p1",
            docId: "d1",
            docTitle: "Doc",
            currentMarkdown: "old",
            proposedMarkdown: "new",
            summary: "Change something",
          },
        }),
      ),
    };
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest([proposalTool]));

    streamMock.mockReturnValueOnce(
      fakeAnthropicStream({
        content: [
          { type: "tool_use", id: "tool-2", name: "propose_doc_edit", input: {} },
        ],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        stop_reason: "tool_use",
      }),
    );

    const response = await POST(makeRequest({ message: "edit the doc" }));
    const events = await readEvents(response);

    const proposalEvent = events.find((e) => e.t === "proposal");
    expect(proposalEvent).toMatchObject({ t: "proposal", id: "tool-2", kind: "doc_edit" });
    // Only ONE model call — the loop must not continue after a proposal.
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]).toEqual({ t: "done" });
  });
});

describe("test_AS_044_client_abort_propagates_to_the_sdk_call", () => {
  it("passes the request's AbortSignal through to client.beta.messages.stream", async () => {
    streamMock.mockReturnValue(
      fakeAnthropicStream({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }),
    );

    const controller = new AbortController();
    await POST(makeRequest({ message: "hi" }, controller.signal));

    expect(streamMock).toHaveBeenCalledTimes(1);
    const [, options] = streamMock.mock.calls[0] as [unknown, { signal?: AbortSignal }];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("test_AS_046_anthropic_429_maps_to_rate_limited_error_code", () => {
  it("emits error code rate_limited then done", async () => {
    const rateLimitError = new RateLimitError(
      429,
      { error: { message: "rate limited" } },
      "rate limited",
      new Headers(),
    );
    streamMock.mockReturnValue(fakeAnthropicStream(rateLimitError));

    const response = await POST(makeRequest({ message: "hi" }));
    const events = await readEvents(response);

    expect(events).toEqual([
      { t: "error", code: "rate_limited", message: expect.any(String) },
      { t: "done" },
    ]);
  });
});

describe("test_AS_048_more_than_8_tool_calls_in_one_turn_stops_with_tool_limit", () => {
  it("emits error code tool_limit then done without exceeding the cap", async () => {
    const tool = {
      name: "search_docs",
      parse: (x: unknown) => x,
      run: vi.fn(async () => JSON.stringify({ status: "empty", reason: "no_results", message: "none" })),
    };
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest([tool]));

    const nineToolUses = Array.from({ length: 9 }, (_, i) => ({
      type: "tool_use" as const,
      id: `tool-${i}`,
      name: "search_docs",
      input: { query: "x" },
    }));

    streamMock.mockReturnValue(
      fakeAnthropicStream({
        content: nineToolUses,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        stop_reason: "tool_use",
      }),
    );

    const response = await POST(makeRequest({ message: "search a lot" }));
    const events = await readEvents(response);

    expect(events).toEqual([
      { t: "error", code: "tool_limit", message: expect.any(String) },
      { t: "done" },
    ]);
    // The tool never actually ran once the cap was tripped for this batch.
    expect(tool.run).not.toHaveBeenCalled();
  });
});

describe("test_AS_105_upstream_failures_never_leak_raw_error_text_or_secrets", () => {
  it("maps a raw upstream error to a short generic message", async () => {
    const rawError = new APIError(
      500,
      { error: { message: "postgres: connection to db failed, password=sekret123" } },
      "postgres: connection to db failed, password=sekret123",
      new Headers(),
    );
    streamMock.mockReturnValue(fakeAnthropicStream(rawError));

    const response = await POST(makeRequest({ message: "hi" }));
    const events = await readEvents(response);

    const errorEvent = events.find((e) => e.t === "error") as { message: string } | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).not.toContain("sekret123");
    expect(errorEvent!.message).not.toContain("postgres");
    expect(events[events.length - 1]).toEqual({ t: "done" });
  });
});
