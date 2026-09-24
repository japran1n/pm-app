import { beforeEach, describe, expect, it, vi } from "vitest";

// SEC-HTTP-09: the sign-in Server Actions are throttled per IP and per
// identifier via lib/rate-limit.ts (distributed RPC, in-process fallback).

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is"]) chain[op] = () => chain;
      chain.limit = async () => ({ data: [], error: null });
      return chain;
    },
  }),
}));

const signInWithOtp = vi.fn(async () => ({ error: null }));
const signInWithPasswordMock = vi.fn(async () => ({ error: { message: "bad" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithOtp, signInWithPassword: signInWithPasswordMock },
  }),
  isPortalPreview: async () => false,
}));

let forwardedFor = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": forwardedFor }),
  cookies: async () => ({ set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  rpcMock.mockReset();
  signInWithOtp.mockClear();
  signInWithPasswordMock.mockClear();
  forwardedFor = "203.0.113.1";
});

function emailForm(email: string) {
  const f = new FormData();
  f.set("email", email);
  return f;
}

describe("signInWithMagicLink rate limit", () => {
  it("uses the distributed counter keyed by IP and email, and refuses when it says no", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    const result = await signInWithMagicLink(null, emailForm("a@example.com"));

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/too many/i) });
    expect(signInWithOtp).not.toHaveBeenCalled();
    const buckets = rpcMock.mock.calls.map((c) => (c[1] as { p_bucket: string }).p_bucket).sort();
    expect(buckets).toEqual(["auth_magic_link_email", "auth_magic_link_ip"]);
  });

  it("falls back to an in-process per-email limit when the RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "down" } });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    const results = [];
    for (let i = 0; i < 6; i++) {
      forwardedFor = `198.51.100.${i}`; // rotate IPs: the email bucket still trips
      results.push(await signInWithMagicLink(null, emailForm("A@Example.com")));
    }
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5].ok).toBe(false);
    expect(signInWithOtp).toHaveBeenCalledTimes(5);
  });
});

describe("signInWithPassword rate limit", () => {
  it("stops calling Supabase after the per-identifier limit", async () => {
    rpcMock.mockRejectedValue(new Error("network"));
    const { signInWithPassword } = await import("@/lib/actions/auth");

    const results = [];
    for (let i = 0; i < 11; i++) {
      const f = new FormData();
      f.set("identifier", "victim@example.com");
      f.set("password", "wrong-password");
      results.push(await signInWithPassword(null, f));
    }
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(10);
    expect(results[10]).toEqual({ ok: false, error: expect.stringMatching(/too many/i) });
  });
});
