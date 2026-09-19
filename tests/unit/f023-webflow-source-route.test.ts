// F023 (TH-050…TH-059, TH-064…TH-068), F024 (TH-060, TH-061),
// F025 (TH-069) — /api/webflow-source route handler.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from "@/app/api/webflow-source/route";
import { isWebflowPasswordGate } from "@/lib/site-preview/guards";

const AUTHED_USER = { id: "user-1", email: "user@example.com" };

function makeRequest(url: string): NextRequest {
  return new NextRequest(
    `https://app.test/api/webflow-source?url=${encodeURIComponent(url)}`,
  );
}

function htmlResponse(
  body: string,
  init: { status?: number; url?: string } = {},
): Response {
  const res = new Response(body, { status: init.status ?? 200 });
  if (init.url) {
    Object.defineProperty(res, "url", { value: init.url });
  }
  return res;
}

describe("GET /api/webflow-source", () => {
  const realFetch = global.fetch;
  const realDnsLookup = require("dns").promises.lookup;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } });
    // Default: resolves to a public address so SSRF guard passes unless a
    // test overrides it.
    require("dns").promises.lookup = vi.fn(async () => [
      { address: "1.2.3.4", family: 4 },
    ]);
  });

  afterEach(() => {
    global.fetch = realFetch;
    require("dns").promises.lookup = realDnsLookup;
  });

  it("test_TH_051_anonymous_request_returns_401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(401);
  });

  it("test_TH_053_missing_url_returns_400", async () => {
    const req = new NextRequest("https://app.test/api/webflow-source");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("test_TH_053_unparseable_url_returns_400", async () => {
    const res = await GET(makeRequest("not-a-url"));
    expect(res.status).toBe(400);
  });

  it("test_TH_052_non_https_scheme_returns_400", async () => {
    const res = await GET(makeRequest("http://foo.webflow.io/"));
    expect(res.status).toBe(400);
  });

  it("rejects a non-webflow host with 403 (host allowlist, isWebflowHost owned by F020)", async () => {
    const res = await GET(makeRequest("https://example.com/"));
    expect(res.status).toBe(403);
  });

  it("test_TH_058_blocked_address_returns_400", async () => {
    require("dns").promises.lookup = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(400);
  });

  it("test_TH_059_literal_localhost_returns_400", async () => {
    const res = await GET(makeRequest("https://localhost/"));
    expect(res.status).toBe(400);
  });

  it("test_TH_050_returns_html_finalUrl_and_blocks", async () => {
    global.fetch = vi.fn(async () =>
      htmlResponse("<html><body>hi</body></html>", {
        url: "https://foo.webflow.io/",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      html: "<html><body>hi</body></html>",
      finalUrl: "https://foo.webflow.io/",
      blocks: [],
    });
  });

  it("test_TH_068_response_has_cache_control_no_store", async () => {
    global.fetch = vi.fn(async () =>
      htmlResponse("<html></html>", { url: "https://foo.webflow.io/" }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("test_TH_067_no_upstream_headers_are_forwarded", async () => {
    global.fetch = vi.fn(async () => {
      const res = htmlResponse("<html></html>", {
        url: "https://foo.webflow.io/",
      });
      res.headers.set("x-upstream-secret", "leak-me");
      res.headers.set("set-cookie", "session=abc");
      return res;
    }) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.headers.get("x-upstream-secret")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("test_TH_066_fetch_sends_no_credentials", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse("<html></html>", { url: "https://foo.webflow.io/" }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(makeRequest("https://foo.webflow.io/"));

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect(init).toBeDefined();
    const headers = new Headers(init.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(init.credentials).not.toBe("include");
  });

  it("test_TH_064_upstream_timeout_returns_504", async () => {
    global.fetch = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(504);
  });

  it("test_TH_065_non_2xx_upstream_status_is_forwarded", async () => {
    global.fetch = vi.fn(async () =>
      htmlResponse("not found", {
        status: 404,
        url: "https://foo.webflow.io/",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(404);
  });

  it("network error returns 502", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(502);
  });

  it("test_TH_060_redirect_to_blocked_address_returns_400", async () => {
    require("dns").promises.lookup = vi
      .fn()
      // First call: pre-flight check on the requested host — public.
      .mockResolvedValueOnce([{ address: "1.2.3.4", family: 4 }])
      // Second call: re-validation of the final host after redirect — blocked.
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    global.fetch = vi.fn(async () =>
      htmlResponse("<html></html>", {
        url: "https://redirected.webflow.io/",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(400);
  });

  it("test_TH_061_redirect_outside_webflow_io_returns_502", async () => {
    global.fetch = vi.fn(async () =>
      htmlResponse("<html></html>", { url: "https://evil.example.com/" }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/redirect left \.webflow\.io domain/i);
  });

  describe("test_TH_069_staging_password_detection", () => {
    it("returns 403 with a legible error when a password gate is detected", async () => {
      const gateHtml = `
        <html data-wf-site="abc123">
          <body>
            <p>This site is password protected.</p>
            <form action="/">
              <input type="password" name="pass" />
              <button type="submit">Enter</button>
            </form>
          </body>
        </html>
      `;
      global.fetch = vi.fn(async () =>
        htmlResponse(gateHtml, { url: "https://foo.webflow.io/" }),
      ) as unknown as typeof fetch;

      const res = await GET(makeRequest("https://foo.webflow.io/"));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("staging_password_required");
      expect(body.message).toMatch(/password/i);
    });

    it("isWebflowPasswordGate is true for a password form with a Webflow marker", () => {
      const html = `<form><input type="password"></form><span>this site is password protected</span>`;
      expect(isWebflowPasswordGate(html)).toBe(true);
    });

    it("isWebflowPasswordGate is false for an ordinary login form without Webflow markers", () => {
      const html = `<form><input type="password"></form>`;
      expect(isWebflowPasswordGate(html)).toBe(false);
    });

    it("isWebflowPasswordGate is false for a normal page with no password field", () => {
      const html = `<html data-wf-site="abc"><body>Welcome</body></html>`;
      expect(isWebflowPasswordGate(html)).toBe(false);
    });

    it("ordinary pages are not misclassified as password gates", async () => {
      global.fetch = vi.fn(async () =>
        htmlResponse("<html><body>Welcome to my site</body></html>", {
          url: "https://foo.webflow.io/",
        }),
      ) as unknown as typeof fetch;

      const res = await GET(makeRequest("https://foo.webflow.io/"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error).toBeUndefined();
    });
  });
});
