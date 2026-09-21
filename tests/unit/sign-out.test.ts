import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock next/navigation's redirect so we can assert the destination without
// Next.js's real throw-based redirect mechanism firing in a unit test.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Mock next/headers (imported transitively by lib/actions/auth.ts).
vi.mock("next/headers", () => ({
  headers: async () => new Map(),
}));

const signOutSpy = vi.fn(async () => ({ error: null as { message: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signOut: signOutSpy,
    },
  }),
  // F024b: signOut() checks this first to decide whether it's exiting a
  // client preview instead of really signing out -- false for every test
  // in this file, which covers the ordinary (non-preview) path.
  isPortalPreview: async () => false,
}));

describe("signOut (AS-022: session is fully cleared on sign-out)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    signOutSpy.mockClear();
  });

  it("AS-022: calls supabase.auth.signOut() via the server client (clears the sb-*-auth-token cookies per @supabase/ssr) and redirects to /sign-in", async () => {
    const { signOut } = await import("@/lib/actions/auth");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/sign-in");

    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("SB-015 (failure case): when Supabase returns an error, signOut does NOT redirect and returns an error result", async () => {
    signOutSpy.mockResolvedValueOnce({ error: { message: "network blip" } });

    const { signOut } = await import("@/lib/actions/auth");

    const result = await signOut();

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("network blip");
  });
});
