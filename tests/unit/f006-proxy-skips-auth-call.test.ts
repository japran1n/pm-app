import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// F006 (AS-005, AS-006): the proxy must not call updateSession()/getUser()
// when the request carries no Supabase auth cookie at all, while producing
// exactly the same redirect decision it produces today. We assert both the
// behavioural outcome (redirect / pass-through) and the call count on the
// mocked Supabase network boundary.
const getUserMock = vi.fn(async () => ({ data: { user: null } }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

// Mirrors the project-ref derivation in lib/supabase/proxy-helpers.ts so
// this test exercises the same cookie name the implementation computes,
// regardless of whether NEXT_PUBLIC_SUPABASE_URL is populated in this test
// run's environment.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const COOKIE_BASE = `sb-${PROJECT_REF}-auth-token`;

describe("F006: proxy skips the auth call when no session cookie is present", () => {
  it("AS-005: no cookie on a protected path (/w/*) redirects to /sign-in without calling getUser()", async () => {
    getUserMock.mockClear();
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/w/acme");
    const response = await proxy(request);

    expect([307, 302]).toContain(response.status);
    expect(response.headers.get("location")).toBe(
      "https://example.com/sign-in",
    );
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("AS-006: no cookie on a public path passes through without calling getUser()", async () => {
    getUserMock.mockClear();
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/");
    const response = await proxy(request);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get("location")).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("AS-005/AS-006: a chunked auth cookie (`...auth-token.0`) is treated as present and still verified via getUser()", async () => {
    getUserMock.mockClear();
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/w/acme");
    request.cookies.set(`${COOKIE_BASE}.0`, "chunk-value");

    await proxy(request);

    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("AS-005/AS-006: a present (even if ultimately invalid) cookie still goes through updateSession/getUser()", async () => {
    getUserMock.mockClear();
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/w/acme");
    request.cookies.set(COOKIE_BASE, "some-token-value");

    await proxy(request);

    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});
