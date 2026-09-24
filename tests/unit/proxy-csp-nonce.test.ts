import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SEC-HTTP-07 / SEC-CONTENT-04: Next reads the CSP nonce from the REQUEST's
// CSP header (app-render `parseRequestHeaders`), so proxy.ts must forward
// the CSP + x-nonce on the request in every pass-through branch, and set the
// CSP on the response in every branch (including redirects).

let user: { id: string } | null = null;
let refreshCookies = false;
const getUserMock = vi.fn(async () => ({ data: { user } }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        if (refreshCookies) {
          opts.cookies.setAll([{ name: "sb-refreshed", value: "v", options: {} }]);
        }
        return getUserMock();
      },
    },
  }),
}));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const COOKIE_BASE = `sb-${PROJECT_REF}-auth-token`;

const RO = "content-security-policy-report-only";
const ENF = "content-security-policy";

function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

function nonceOf(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([A-Za-z0-9+/_-]+={0,2})'/)?.[1];
}

beforeEach(() => {
  user = null;
  refreshCookies = false;
  getUserMock.mockClear();
  delete process.env.CSP_ENFORCE;
});
afterEach(() => {
  delete process.env.CSP_ENFORCE;
});

describe("proxy CSP + nonce forwarding", () => {
  it("no-cookie public path: CSP + nonce on the forwarded request and CSP on the response", async () => {
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://example.com/sign-in"));

    const responseCsp = response.headers.get(RO);
    const requestCsp = forwarded(response, RO);
    expect(responseCsp).toBeTruthy();
    expect(requestCsp).toBe(responseCsp);
    const nonce = nonceOf(responseCsp);
    expect(nonce).toBeTruthy();
    expect(forwarded(response, "x-nonce")).toBe(nonce);
    expect(response.headers.get(ENF)).toBeNull();
    // Nonce is not echoed as a response header.
    expect(response.headers.get("x-nonce")).toBeNull();
  });

  it("no-cookie protected path: redirect still carries the CSP", async () => {
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://example.com/w/acme"));
    expect(response.headers.get("location")).toBe("https://example.com/sign-in");
    expect(nonceOf(response.headers.get(RO))).toBeTruthy();
  });

  it("session branch (updateSession): forwards CSP + nonce and keeps refreshed cookies", async () => {
    user = { id: "u1" };
    refreshCookies = true;
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.com/w/acme");
    request.cookies.set(COOKIE_BASE, "token");
    const response = await proxy(request);

    expect(getUserMock).toHaveBeenCalledTimes(1);
    const responseCsp = response.headers.get(RO);
    expect(forwarded(response, RO)).toBe(responseCsp);
    expect(forwarded(response, "x-nonce")).toBe(nonceOf(responseCsp));
    expect(forwarded(response, "cookie")).toContain("sb-refreshed=v");
    expect(response.cookies.get("sb-refreshed")?.value).toBe("v");
  });

  it("session branch without a user on a protected path: redirect carries the CSP", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.com/w/acme");
    request.cookies.set(COOKIE_BASE, "token");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("https://example.com/sign-in");
    expect(nonceOf(response.headers.get(RO))).toBeTruthy();
  });

  it("mints a fresh nonce per request", async () => {
    const { proxy } = await import("@/proxy");
    const a = await proxy(new NextRequest("https://example.com/"));
    const b = await proxy(new NextRequest("https://example.com/"));
    expect(nonceOf(a.headers.get(RO))).not.toBe(nonceOf(b.headers.get(RO)));
  });

  it("drops a client-supplied CSP request header so it cannot choose the nonce", async () => {
    const { proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://example.com/", {
        headers: { [ENF]: "script-src 'nonce-attacker'" },
      }),
    );
    // Overridden request headers are listed; the forged enforcing header is
    // not forwarded, ours is.
    expect(forwarded(response, ENF)).toBeNull();
    expect(nonceOf(forwarded(response, RO))).not.toBe("attacker");
  });

  it("CSP_ENFORCE=true emits the enforcing header (request + response) instead of Report-Only", async () => {
    process.env.CSP_ENFORCE = "true";
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://example.com/"));
    expect(response.headers.get(RO)).toBeNull();
    const csp = response.headers.get(ENF);
    expect(csp).toBeTruthy();
    expect(forwarded(response, ENF)).toBe(csp);
    expect(forwarded(response, RO)).toBeNull();
  });
});

describe("buildCsp", () => {
  it("contains every required source", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcref.supabase.co");
    const { buildCsp } = await import("@/proxy");
    const csp = buildCsp("N0nce==", { isDev: false, enforce: false });
    vi.unstubAllEnvs();

    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'nonce-N0nce==' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data: https://abcref.supabase.co",
      "worker-src 'self' blob:",
      "connect-src 'self' https://abcref.supabase.co wss://abcref.supabase.co",
      "frame-src 'self' https: blob: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "report-uri /api/csp-report",
    ]) {
      expect(csp).toContain(directive);
    }
    // No eval in production; a style nonce would disable 'unsafe-inline'.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/style-src[^;]*nonce/);
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("dev adds 'unsafe-eval' and HMR websockets; enforce (prod) adds upgrade-insecure-requests", async () => {
    const { buildCsp } = await import("@/proxy");
    expect(buildCsp("n", { isDev: true, enforce: false })).toContain("'strict-dynamic' 'unsafe-eval'");
    expect(buildCsp("n", { isDev: true, enforce: false })).toMatch(/connect-src [^;]* ws: wss:/);
    expect(buildCsp("n", { isDev: false, enforce: true })).toContain("upgrade-insecure-requests");
  });

  it("the nonce is parseable by Next's own header parser", async () => {
    const { buildCsp } = await import("@/proxy");
    const { getScriptNonceFromHeader } = await import(
      "next/dist/server/app-render/get-script-nonce-from-header"
    );
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    expect(getScriptNonceFromHeader(buildCsp(nonce, { isDev: false }))).toBe(nonce);
  });
});
