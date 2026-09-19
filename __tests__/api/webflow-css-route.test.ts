// F026 (TH-080..TH-084): /api/webflow-source/css stylesheet proxy.
// Mocks fetch and Supabase auth to cover every status code branch without
// hitting the network or a real session.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
  })),
}));

import { GET } from "@/app/api/webflow-source/css/route";

function makeRequest(url: string) {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof GET>[0];
}

describe("F026 /api/webflow-source/css", () => {
  beforeEach(() => {
    currentUser = { id: "user-1" };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("test_TH_082_auth_required_returns_401", async () => {
    currentUser = null;
    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://site.webflow.io/style.css",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("test_TH_081_non_webflow_host_returns_400", async () => {
    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://evil.com/style.css",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("test_TH_081_missing_url_returns_400", async () => {
    const res = await GET(makeRequest("http://localhost/api/webflow-source/css"));
    expect(res.status).toBe(400);
  });

  it("test_TH_081_http_scheme_returns_400", async () => {
    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=http://site.webflow.io/style.css",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("test_TH_080_TH_084_proxies_css_with_correct_content_type", async () => {
    const body = "body { color: red; }";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/css; charset=utf-8" },
      }),
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://site.webflow.io/style.css",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const text = await res.text();
    expect(text).toBe(body);
  });

  it("test_TH_083_oversized_body_returns_413", async () => {
    const big = "a".repeat(512 * 1024 + 1);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(big, { status: 200 }),
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://site.webflow.io/style.css",
      ),
    );

    expect(res.status).toBe(413);
  });

  it("network error returns 502", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://site.webflow.io/style.css",
      ),
    );

    expect(res.status).toBe(502);
  });

  it("upstream non-ok status returns 502", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("not found", { status: 404 }),
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/webflow-source/css?url=https://site.webflow.io/style.css",
      ),
    );

    expect(res.status).toBe(502);
  });
});
