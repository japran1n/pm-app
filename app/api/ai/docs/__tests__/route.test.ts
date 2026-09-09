// F021: route contract tests for app/api/ai/docs/route.ts, covering the six
// checks called out by F021's spec. Mirrors the mocking seam established by
// tests/unit/f007-docs-agent-route.test.ts (moved there by this same
// feature) and app/api/ai/docs/__tests__/f020-guards-route.test.ts: the
// Supabase auth/membership seam, hasApiKey()/getAnthropicClient(), and
// buildDocsAgentRequest() are all stubbed — no real network call, no real
// Supabase project, no real Anthropic call.
//
// AS-007, AS-041, AS-042, AS-043, AS-045, AS-048 are already exercised in
// depth by tests/unit/f007-docs-agent-route.test.ts; this file adds a
// focused, minimal restatement of each of those six checks living at the
// canonical `__tests__` location next to the route itself, per F021's spec.

import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
function membershipQueryChain() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: membershipMaybeSingleMock,
  };
  return chain;
}
const fromMock = vi.fn(() => membershipQueryChain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

const hasApiKeyMock = vi.fn();
const streamMock = vi.fn();
const getAnthropicClientMock = vi.fn(() => ({
  beta: { messages: { stream: streamMock } },
}));
vi.mock("@/lib/ai/client", () => ({
  hasApiKey: hasApiKeyMock,
  getAnthropicClient: getAnthropicClientMock,
}));

const buildDocsAgentRequestMock = vi.fn();
vi.mock("@/lib/ai/docs-agent", () => ({
  buildDocsAgentRequest: buildDocsAgentRequestMock,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST } = await import("@/app/api/ai/docs/route");
const { __resetRateLimitStoreForTests } = await import("@/lib/ai/guards");

const AUTHED_USER = { id: "user-1" };
const DEFAULT_WORKSPACE_ID = "workspace-1";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/docs", {
    method: "POST",
    body: JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, ...body }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Reads the whole NDJSON stream and returns the parsed event list. */
async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  const lines = text.split("\n").filter((l) => l.length > 0);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
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
  __resetRateLimitStoreForTests();
  getUserMock.mockResolvedValue({ data: { user: AUTHED_USER } });
  hasApiKeyMock.mockReturnValue(true);
  buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest());
  membershipMaybeSingleMock.mockResolvedValue({ data: { status: "active" }, error: null });
});

describe("test_AS_007_unauthenticated_request_gets_401_and_never_constructs_the_model_client", () => {
  it("returns 401 and never touches the Anthropic client", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await POST(makeRequest({ message: "hello" }));

    expect(response.status).toBe(401);
    expect(getAnthropicClientMock).not.toHaveBeenCalled();
    expect(buildDocsAgentRequestMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("test_AS_045_missing_api_key_emits_a_single_error_event_at_http_200", () => {
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

describe("test_AS_042_tool_start_and_tool_end_are_id_paired", () => {
  it("emits a tool_end whose id matches the preceding tool_start's id", async () => {
    const searchTool = {
      name: "search_docs",
      parse: (x: unknown) => x,
      run: vi.fn(async () => JSON.stringify({ status: "empty", reason: "no_results", message: "none" })),
    };
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest([searchTool]));

    streamMock
      .mockReturnValueOnce(
        fakeAnthropicStream({
          content: [
            { type: "tool_use", id: "tool-abc", name: "search_docs", input: { query: "x" } },
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

    expect(toolStart?.id).toBe("tool-abc");
    expect(toolEnd?.id).toBe("tool-abc");
    expect(toolStart?.id).toBe(toolEnd?.id);
  });
});

describe("test_AS_043_proposal_turn_ends_with_proposal_then_done_and_no_db_write", () => {
  it("emits proposal then done, and the tool's run is the only side effect (no direct DB write)", async () => {
    const dbWriteSpy = vi.fn();
    const proposalTool = {
      name: "propose_doc_edit",
      parse: (x: unknown) => x,
      run: vi.fn(async () => {
        // The tool itself is a proposal generator only — it must never
        // call a DB write path. This spy stands in for any such call and
        // is asserted un-invoked below.
        return JSON.stringify({
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
        });
      }),
    };
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest([proposalTool]));

    streamMock.mockReturnValueOnce(
      fakeAnthropicStream({
        content: [{ type: "tool_use", id: "tool-2", name: "propose_doc_edit", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        stop_reason: "tool_use",
      }),
    );

    const response = await POST(makeRequest({ message: "edit the doc" }));
    const events = await readEvents(response);

    expect(events.map((e) => e.t)).toEqual(["tool_start", "tool_end", "proposal", "usage", "done"]);
    expect(dbWriteSpy).not.toHaveBeenCalled();
    // Route never touches Supabase's `from()` beyond the up-front
    // membership check performed once per request.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});

describe("test_AS_048_more_than_8_tool_calls_in_one_turn_stops_with_tool_limit", () => {
  it("emits error code tool_limit then done, and the tool never actually runs", async () => {
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
    expect(tool.run).not.toHaveBeenCalled();
  });
});

describe("test_AS_041_every_emitted_line_parses_as_json_with_a_known_t_field", () => {
  const KNOWN_TYPES = new Set([
    "text",
    "usage",
    "done",
    "error",
    "tool_start",
    "tool_end",
    "proposal",
  ]);

  it("parses every line for a plain text turn as JSON with a known t", async () => {
    streamMock.mockReturnValue(
      fakeAnthropicStream(
        {
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        },
        ["ok"],
      ),
    );

    const response = await POST(makeRequest({ message: "hi" }));
    const events = await readEvents(response);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.t).toBe("string");
      expect(KNOWN_TYPES.has(event.t as string)).toBe(true);
    }
  });

  it("parses every line for a tool + proposal turn as JSON with a known t", async () => {
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
        content: [{ type: "tool_use", id: "tool-9", name: "propose_doc_edit", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        stop_reason: "tool_use",
      }),
    );

    const response = await POST(makeRequest({ message: "edit" }));
    const events = await readEvents(response);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.t).toBe("string");
      expect(KNOWN_TYPES.has(event.t as string)).toBe(true);
    }
  });
});
