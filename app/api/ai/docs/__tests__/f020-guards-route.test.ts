// F020 (AS-046, AS-048, AS-105): route-level tests for the guards wired
// into app/api/ai/docs/route.ts — per-user rate limit and per-thread
// token ceiling. Mirrors tests/integration/f007-docs-agent-route.test.ts's
// mocking seam (Supabase auth/membership, hasApiKey, buildDocsAgentRequest)
// so these run with no real network call.

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
const { __resetRateLimitStoreForTests, THREAD_TOKEN_CEILING } = await import("@/lib/ai/guards");

const AUTHED_USER = { id: "user-1" };
const DEFAULT_WORKSPACE_ID = "workspace-1";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/docs", {
    method: "POST",
    body: JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, ...body }),
    headers: { "Content-Type": "application/json" },
  });
}

async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function baseAgentRequest() {
  return {
    model: "claude-opus-5",
    max_tokens: 16000,
    system: [{ type: "text", text: "system" }],
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    stream: true,
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

describe("test_AS_046_rate_limited_user_gets_a_single_error_event_at_http_200", () => {
  it("allows the first 20 requests in a window", async () => {
    for (let i = 0; i < 20; i++) {
      const response = await POST(makeRequest({ message: `msg ${i}` }));
      expect(response.status).toBe(200);
      const events = await readEvents(response);
      // Not rate-limited — the normal model flow was reached.
      expect(events.some((e) => e.code === "rate_limit")).toBe(false);
    }
  });

  it("blocks the 21st request with a single error event, then done, at HTTP 200", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest({ message: `msg ${i}` }));
    }

    const response = await POST(makeRequest({ message: "one too many" }));
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    expect(events).toEqual([
      { t: "error", code: "rate_limit", message: expect.any(String) },
      { t: "done" },
    ]);
    expect(events).toHaveLength(2);
  });

  it("never calls the model when rate-limited", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest({ message: `msg ${i}` }));
    }
    vi.clearAllMocks();
    // clearAllMocks reset the mock call counts, but re-establish the
    // return values it also wiped.
    hasApiKeyMock.mockReturnValue(true);
    buildDocsAgentRequestMock.mockResolvedValue(baseAgentRequest());

    await POST(makeRequest({ message: "one too many" }));
    expect(buildDocsAgentRequestMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("test_AS_046_thread_token_ceiling", () => {
  it("allows a thread under the ceiling", async () => {
    const response = await POST(
      makeRequest({ message: "hi", threadUsage: THREAD_TOKEN_CEILING - 1 }),
    );
    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(events.some((e) => e.code === "thread_limit")).toBe(false);
  });

  it("blocks a thread at the ceiling with a thread_limit error, then done, at HTTP 200", async () => {
    const response = await POST(
      makeRequest({ message: "hi", threadUsage: THREAD_TOKEN_CEILING }),
    );
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    expect(events).toEqual([
      { t: "error", code: "thread_limit", message: expect.any(String) },
      { t: "done" },
    ]);
    expect(buildDocsAgentRequestMock).not.toHaveBeenCalled();
  });
});
