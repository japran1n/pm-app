// F022 (SB-015, redirect half): exercise the REAL signOut action with the REAL
// next/navigation redirect (not mocked). Next's redirect() throws an error
// whose digest encodes the destination; assert that instead of a mock call.
// Only the Supabase client (network boundary) and next/headers are stubbed.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Map() }));

const signOutSpy = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: signOutSpy } }),
  isPortalPreview: async () => false,
}));

describe("SB-015 sign out redirect (real action, real redirect)", () => {
  it("test_SB_015_signOut_ends_session_and_redirects_to_sign_in", async () => {
    const { signOut } = await import("@/lib/actions/auth");
    let thrown: unknown;
    try {
      await signOut();
    } catch (e) {
      thrown = e;
    }
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    const digest = (thrown as { digest?: string } | undefined)?.digest ?? "";
    expect(digest).toMatch(/^NEXT_REDIRECT;(replace|push);\/sign-in;/);
  });
});
