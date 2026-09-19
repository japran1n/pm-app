// FU-1 — SSRF guard + host validation fix for /api/webflow-source/css.
// Scrutiny blocker B1: the CSS proxy route never validated the resolved URL
// after following redirects, and never re-checked isWebflowHost on the
// fetched URL. This file covers the fix, mirroring the F023 HTML route
// tests in tests/unit/f023-webflow-source-route.test.ts.

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

import { GET } from "@/app/api/webflow-source/css/route";

const AUTHED_USER = { id: "user-1", email: "user@example.com" };

function makeRequest(url: string): NextRequest {
  return new NextRequest(
    `https://app.test/api/webflow-source/css?url=${encodeURIComponent(url)}`,
  );
}

function cssResponse(
  body: string,
  init: { status?: number; url?: string } = {},
): Response {
  const res = new Response(body, { status: init.status ?? 200 });
  if (init.url) {
    Object.defineProperty(res, "url", { value: init.url });
  }
  return res;
}

describe("GET /api/webflow-source/css (FU-1 SSRF fix)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("rejects a non-webflow host in the url param with 400", async () => {
    const res = await GET(makeRequest("https://example.com/style.css"));
    expect(res.status).toBe(400);
    // fetch must never be reached for a rejected host
  });

  it("SSRF: redirect to a private/internal host returns 403", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: red }", {
        // Upstream 30x lands somewhere off webflow.io — e.g. an internal
        // metadata service or private IP host.
        url: "http://169.254.169.254/latest/meta-data/",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/style.css"));
    expect(res.status).toBe(403);
  });

  it("SSRF: redirect to an unrelated external host returns 403", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: red }", {
        url: "https://evil.example.com/style.css",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/style.css"));
    expect(res.status).toBe(403);
  });

  it("valid webflow.io host returns the CSS body with private cache-control", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: red }", {
        url: "https://foo.webflow.io/style.css",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/style.css"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body { color: red }");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("anonymous request returns 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest("https://foo.webflow.io/style.css"));
    expect(res.status).toBe(401);
  });

  // TH-082 — Webflow's real published CSS is served from its CDN, not from
  // *.webflow.io. Both origins must be allowed.
  it("test_TH_082_allows_cdn_prod_website_files_com", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: blue }", {
        url: "https://cdn.prod.website-files.com/abc123/style.css",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(
      makeRequest("https://cdn.prod.website-files.com/abc123/style.css"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body { color: blue }");
  });

  it("test_TH_082_still_allows_webflow_io_subdomains", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: green }", {
        url: "https://foo.webflow.io/style.css",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(makeRequest("https://foo.webflow.io/style.css"));
    expect(res.status).toBe(200);
  });

  it("test_TH_082_rejects_an_unrelated_host_that_is_not_the_cdn_or_webflow_io", async () => {
    const res = await GET(makeRequest("https://example.com/style.css"));
    expect(res.status).toBe(400);
  });

  it("test_TH_082_rejects_a_redirect_off_the_allowed_hosts", async () => {
    global.fetch = vi.fn(async () =>
      cssResponse("body { color: red }", {
        url: "https://evil.example.com/style.css",
      }),
    ) as unknown as typeof fetch;

    const res = await GET(
      makeRequest("https://cdn.prod.website-files.com/abc123/style.css"),
    );
    expect(res.status).toBe(403);
  });
});
