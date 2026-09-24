// getLinkPreview hardening: auth required, SSRF-safe transport, bounded body
// read, linear-time parsing, per-user rate limit.

import dns from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ supabase: null, user: currentUser })),
}));

let rpcResult: { data: unknown; error: unknown } = { data: true, error: null };
const rpc = vi.fn(async () => rpcResult);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getLinkPreview } from "@/lib/chat/link-preview";
import { clearLinkPreviewCacheForTests } from "@/lib/chat/link-preview-cache";
import { extractLinkPreviewMeta, truncateToHead } from "@/lib/chat/link-preview-parse";
import {
  LINK_PREVIEW_LIMIT,
  bumpLocalWindow,
  resetLinkPreviewRateLimitForTests,
} from "@/lib/chat/link-preview-rate-limit";
import { transport } from "@/lib/site-preview/safe-fetch";

const PAGE = new URL("https://example.com/page");
const realTransport = transport.fetch;
const realLookup = dns.promises.lookup;
let fetchMock: ReturnType<typeof vi.fn>;

function htmlResponse(body: string | ReadableStream<Uint8Array>): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

beforeEach(() => {
  currentUser = { id: "user-1" };
  rpcResult = { data: true, error: null };
  rpc.mockClear();
  clearLinkPreviewCacheForTests();
  resetLinkPreviewRateLimitForTests();
  fetchMock = vi.fn(async () =>
    htmlResponse('<html><head><meta property="og:title" content="Hello"></head></html>'),
  );
  transport.fetch = fetchMock as unknown as typeof transport.fetch;
  dns.promises.lookup = vi.fn(async (host: string) =>
    host === "internal.example.com"
      ? [{ address: "::ffff:10.0.0.5", family: 6 }]
      : [{ address: "93.184.215.14", family: 4 }],
  ) as unknown as typeof dns.promises.lookup;
});

afterEach(() => {
  transport.fetch = realTransport;
  dns.promises.lookup = realLookup;
});

describe("getLinkPreview access control", () => {
  it("refuses an unauthenticated caller without fetching", async () => {
    currentUser = null;
    expect(await getLinkPreview("https://example.com/")).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a preview for a signed-in caller", async () => {
    const result = await getLinkPreview("https://example.com/");
    expect(result).toMatchObject({ ok: true, data: { title: "Hello" } });
    expect(rpc).toHaveBeenCalledWith(
      "bump_extension_rate_limit",
      expect.objectContaining({ p_user_id: "user-1", p_bucket: "chat_link_preview" }),
    );
  });

  it("returns ok:false when rate limited, without fetching or caching", async () => {
    rpcResult = { data: false, error: null };
    expect(await getLinkPreview("https://example.com/rl")).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    rpcResult = { data: true, error: null };
    expect((await getLinkPreview("https://example.com/rl")).ok).toBe(true);
  });

  it("falls back to an in-process window when the RPC fails", async () => {
    rpcResult = { data: null, error: { message: "missing function" } };
    for (let i = 0; i < LINK_PREVIEW_LIMIT; i++) {
      await getLinkPreview(`https://example.com/p${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(LINK_PREVIEW_LIMIT);
    expect(await getLinkPreview("https://example.com/one-more")).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(LINK_PREVIEW_LIMIT);
  });

  it("bumpLocalWindow resets on the next window", () => {
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < LINK_PREVIEW_LIMIT; i++) expect(bumpLocalWindow("u", t0)).toBe(true);
    expect(bumpLocalWindow("u", t0)).toBe(false);
    expect(bumpLocalWindow("u", t0 + 60_000)).toBe(true);
  });
});

describe("getLinkPreview SSRF", () => {
  it.each([
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.1/",
    "http://[::]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://internal.example.com/",
  ])("never requests %s", async (target) => {
    expect(await getLinkPreview(target)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect to a private address", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://internal.example.com/" } }),
    );
    expect(await getLinkPreview("https://example.com/redir")).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("bounded body read", () => {
  it("stops reading at </head> and never pulls the rest of the body", async () => {
    let pulls = 0;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) {
          controller.enqueue(
            encoder.encode('<html><head><meta property="og:title" content="Head only"></head>'),
          );
        } else {
          controller.enqueue(encoder.encode("<p>" + "x".repeat(16 * 1024) + "</p>"));
        }
      },
    });
    fetchMock.mockResolvedValueOnce(htmlResponse(stream));
    const result = await getLinkPreview("https://example.com/endless");
    expect(result).toMatchObject({ ok: true, data: { title: "Head only" } });
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it("stops reading after 64KB when there is no </head>", async () => {
    let bytes = 0;
    const chunk = new TextEncoder().encode("<meta " + "a".repeat(8 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    fetchMock.mockResolvedValueOnce(htmlResponse(stream));
    expect(await getLinkPreview("https://example.com/no-head")).toEqual({ ok: false });
    expect(bytes).toBeLessThan(128 * 1024);
  });
});

describe("linear-time parsing (ReDoS)", () => {
  const KB512 = 512 * 1024;
  it.each([
    ["unterminated meta", "<meta " + "a".repeat(KB512)],
    ["meta property run", '<meta property="og:title" '.repeat(KB512 / 26)],
    ["repeated meta openers", "<meta ".repeat(KB512 / 6)],
    ["quote flood", '<meta content="' + "'".repeat(KB512)],
    ["unterminated title", "<title>" + "a".repeat(KB512)],
  ])("%s (512KB) parses in < 200ms", (_name, html) => {
    const start = performance.now();
    extractLinkPreviewMeta(html, PAGE);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("extracts OG fields in either attribute order and decodes entities", () => {
    const parsed = extractLinkPreviewMeta(
      `<head>
        <meta content="Tom &amp; Jerry" property="og:title">
        <meta name="twitter:description" content="desc">
        <meta property="og:image" content="/img.png">
        <meta property="og:site_name" content="Site">
      </head>`,
      PAGE,
    );
    expect(parsed).toEqual({
      title: "Tom & Jerry",
      description: "desc",
      imageUrl: "https://example.com/img.png",
      siteName: "Site",
    });
  });

  it("falls back to <title> and drops non-http image URLs", () => {
    expect(
      extractLinkPreviewMeta(
        '<title> Plain </title><meta property="og:image" content="javascript:alert(1)">',
        PAGE,
      ),
    ).toEqual({ title: "Plain", description: null, imageUrl: null, siteName: null });
  });

  it("ignores tags after </head>", () => {
    expect(
      extractLinkPreviewMeta('<head></head><meta property="og:title" content="Body">', PAGE),
    ).toBeNull();
    expect(truncateToHead("<head><title>x</title></HEAD><body>")).toBe(
      "<head><title>x</title></HEAD>",
    );
  });
});
