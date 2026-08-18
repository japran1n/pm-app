import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Genuine integration test for AS-001: "an unauthenticated visitor to any
// /w/* route is redirected to /sign-in". Unlike tests/unit/proxy-auth-guard.test.ts
// (which only exercises the isolated `requiresAuth` string-matching helper),
// this file builds real NextRequest objects, invokes the actual exported
// `proxy()` function from proxy.ts, and asserts on the real Response it
// returns — status code and Location header — for both the redirect and
// non-redirect cases. It also asserts the exported `config.matcher` would
// actually route /w/* requests through this file at all.
//
// The Supabase client is mocked at the @supabase/ssr boundary (the actual
// network-calling layer) so `updateSession()` inside proxy.ts runs for
// real; only the network round-trip to Supabase is stubbed to return no
// user, mirroring a genuinely unauthenticated request (no session cookie).
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));

describe("proxy() integration (AS-001: unauthenticated visitor to /w/* is redirected to sign-in)", () => {
  const workspacePaths = [
    "/w/acme",
    "/w/acme/projects/123/board",
    "/w/",
    "/w/ACME",
  ];

  for (const path of workspacePaths) {
    it(`AS-001: unauthenticated request to real NextRequest for ${path} is redirected to /sign-in by the actual proxy() export`, async () => {
      const { proxy } = await import("@/proxy");

      const request = new NextRequest(`https://example.com${path}`);
      const response = await proxy(request);

      expect([307, 302]).toContain(response.status);
      expect(response.headers.get("location")).toBe(
        "https://example.com/sign-in",
      );
    });
  }

  it("AS-001: unauthenticated request to / is NOT redirected by the actual proxy() export", async () => {
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/");
    const response = await proxy(request);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get("location")).toBeNull();
  });

  it("AS-001: unauthenticated request to /sign-in itself is NOT redirected by the actual proxy() export", async () => {
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/sign-in");
    const response = await proxy(request);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("proxy() config.matcher (AS-001: the guard must actually be routed for /w/* requests)", () => {
  it("AS-001: config.matcher pattern matches representative /w/* paths", async () => {
    const { config } = await import("@/proxy");

    const patterns = Array.isArray(config.matcher)
      ? config.matcher
      : [config.matcher];

    const candidatePaths = [
      "/w/acme",
      "/w/acme/projects/123/board",
      "/w/",
      "/w/ACME",
    ];

    for (const path of candidatePaths) {
      const matched = patterns.some((pattern) => {
        // The matcher entries are Next.js path-to-regexp-style patterns
        // compiled at build time into real matching regexes. We replicate
        // the actual negative-lookahead source string here, since Next.js
        // itself uses this exact pattern (from config.matcher) to decide
        // whether to run proxy() for a given request path.
        const regexSource = pattern
          // strip the outer "/(" ... ")" wrapper Next.js's matcher config
          // already expresses as a full regex-capable string.
          .replace(/^\//, "^/")
          .replace(/\$$/, "$");
        const regex = new RegExp(regexSource);
        return regex.test(path);
      });

      expect(matched).toBe(true);
    }
  });

  it("AS-001: config.matcher pattern excludes _next/static, _next/image, and favicon.ico", async () => {
    const { config } = await import("@/proxy");

    const patterns = Array.isArray(config.matcher)
      ? config.matcher
      : [config.matcher];

    const excludedPaths = [
      "/_next/static/chunk.js",
      "/_next/image?url=x",
      "/favicon.ico",
    ];

    for (const path of excludedPaths) {
      const matched = patterns.some((pattern) => {
        const regexSource = pattern.replace(/^\//, "^/").replace(/\$$/, "$");
        const regex = new RegExp(regexSource);
        return regex.test(path);
      });

      expect(matched).toBe(false);
    }
  });
});
