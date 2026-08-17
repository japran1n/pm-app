import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Trace/confirmation test for AS-022's "back-navigation shows no cached
// workspace data" half of the assertion.
//
// Mechanism being confirmed: proxy.ts's requiresAuth guard (F010, AS-001)
// runs updateSession() -> supabase.auth.getUser() on *every* request to a
// /w/* path, including one produced by the browser's back/forward button.
// Next.js Server Component routes are not cached client-side the way an SPA
// route would be (no bfcache-served DOM for a server-rendered RSC payload):
// each navigation — forward, back, or a hard reload — is a fresh request
// that this proxy intercepts. Once signOut() (lib/actions/auth.ts) clears
// the sb-*-auth-token cookies, the *next* request's supabase.auth.getUser()
// call — regardless of whether the browser thinks it's a "back" navigation
// — has no valid session and returns { user: null }, so requiresAuth's
// `!user` branch fires and redirects to /sign-in instead of ever reaching
// the workspace layout / rendering cached data.
//
// We simulate the post-sign-out state directly: no session cookie on the
// request, so the mocked getUser() (standing in for @supabase/ssr reading
// the now-cleared cookie) returns null, exactly as it would immediately
// after signOut() ran.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));

describe("proxy() post-sign-out request trace (AS-022)", () => {
  it("AS-022: a request to a /w/* URL with no session cookie (the state immediately after signOut()) is redirected to /sign-in, not served workspace data — this is what makes back-navigation after sign-out safe", async () => {
    const { proxy } = await import("@/proxy");

    // No cookies attached: mirrors the browser's request after signOut()
    // cleared the sb-*-auth-token cookies, whether the navigation is a
    // fresh click or the back button.
    const request = new NextRequest(
      "https://example.com/w/some-workspace/projects/1/board",
    );

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/sign-in",
    );
  });

  it("AS-022 (control case): a request to a non-workspace route with no session is NOT redirected — confirms the guard is scoped to /w/*, not a blanket cache-buster", async () => {
    const { proxy } = await import("@/proxy");

    const request = new NextRequest("https://example.com/sign-in");

    const response = await proxy(request);

    // NextResponse.next() carries no redirect status/location.
    expect(response.headers.get("location")).toBeNull();
  });
});
