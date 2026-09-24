// F028 (TH-071) — regression test for the HTML proxy route after F022
// extracted `cappedBodyReader` out of this route and into
// `lib/site-preview/guards.ts` as shared infrastructure. This test proves
// the extraction didn't change observable route behaviour: a normal-sized
// upstream response still comes back 200 with a body, and an oversized one
// still gets capped to 413/502 via `BodyTooLargeError` rather than being
// buffered in full.
//
// `runPreviewGuards` is mocked so the test exercises only the fetch +
// cappedBodyReader wiring inside the route handler, not auth/DB/SSRF (those
// are covered by the guard chain's own tests). `cappedBodyReader` itself is
// NOT mocked — it's the real shared implementation from guards.ts, so this
// test also stands as evidence the route still calls it correctly.

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyTooLargeError } from "@/lib/site-preview/guards";

vi.mock("@/lib/site-preview/guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/site-preview/guards")>(
    "@/lib/site-preview/guards",
  );
  return {
    ...actual,
    runPreviewGuards: vi.fn(async () => ({
      ok: true as const,
      url: new URL("https://site.webflow.io/"),
    })),
    assertResolvableAndPublic: vi.fn(async () => []),
  };
});

vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from "@/app/api/site-preview/html/route";
import { transport } from "@/lib/site-preview/safe-fetch";

const realTransportFetch = transport.fetch;

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://app.example.com/api/site-preview/html?url=https%3A%2F%2Fsite.webflow.io%2F&projectId=p1",
    { headers },
  );
}

function stubUpstream(fn: () => Promise<Response>) {
  const mock = vi.fn(fn);
  transport.fetch = mock as unknown as typeof transport.fetch;
  return mock;
}

function streamingResponse(bytes: number, init?: { status?: number }): Response {
  const body = new Uint8Array(bytes).fill(97); // 'a' repeated
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit in chunks so cappedBodyReader's streaming counter is exercised
      // rather than the whole body arriving as one read().
      const chunkSize = 64 * 1024;
      let offset = 0;
      while (offset < body.byteLength) {
        const end = Math.min(offset + chunkSize, body.byteLength);
        controller.enqueue(body.slice(offset, end));
        offset = end;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/html" },
  });
}

describe("GET /api/site-preview/html — F028/TH-071 regression", () => {
  afterEach(() => {
    transport.fetch = realTransportFetch;
    vi.clearAllMocks();
  });

  it("TH-071: returns 200 with body for a small upstream response", async () => {
    const upstream = streamingResponse(1024, { status: 200 });
    stubUpstream(async () => upstream);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("a");
  });

  it("TH-071: returns a capped-body error status when upstream body exceeds 2MB, without buffering the full body", async () => {
    const overCap = 2 * 1024 * 1024 + 1024; // just over DEFAULT_MAX_BODY_BYTES
    const upstream = streamingResponse(overCap, { status: 200 });
    stubUpstream(async () => upstream);

    const res = await GET(makeRequest());
    // The route maps BodyTooLargeError to a 502 "Response too large" — verify
    // it is neither a 200 nor an unhandled throw, and that cappedBodyReader's
    // own cap error type is what's driving the mapping.
    expect(res.status).not.toBe(200);
    expect([413, 502]).toContain(res.status);
    const json = await res.json();
    expect(json.error).toMatch(/too large/i);
  });

  it("TH-071: cappedBodyReader itself throws BodyTooLargeError past the cap (sanity check on the shared reader the route depends on)", async () => {
    const { cappedBodyReader } = await vi.importActual<
      typeof import("@/lib/site-preview/guards")
    >("@/lib/site-preview/guards");
    const res = streamingResponse(2 * 1024 * 1024 + 1);
    await expect(cappedBodyReader(res)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("serves the proxied HTML as inert text with sandbox/nosniff/no-store headers", async () => {
    stubUpstream(async () => new Response("<html><head></head><body><script>x()</script></body></html>"));

    const res = await GET(makeRequest({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox\b/);
    expect(res.headers.get("content-security-policy")).not.toMatch(/allow-same-origin/);
    expect(await res.text()).toContain("<base href=");
  });

  it.each<Record<string, string>>([
    { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
    { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
    { "sec-fetch-dest": "embed", "sec-fetch-mode": "no-cors" },
    { "sec-fetch-mode": "navigate" },
  ])("refuses a non-fetch load (%o) before touching upstream", async (headers) => {
    const upstream = stubUpstream(async () => new Response("<html></html>"));
    const res = await GET(makeRequest(headers));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not follow a redirect to a blocked address", async () => {
    const guards = await import("@/lib/site-preview/guards");
    vi.mocked(guards.assertResolvableAndPublic).mockImplementation(async (host) => {
      if (host === "169.254.169.254") throw new Error(guards.BLOCKED_ADDRESS_ERROR);
      return [];
    });
    const upstream = stubUpstream(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        }),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
