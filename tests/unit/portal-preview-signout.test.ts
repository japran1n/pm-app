// F024b (missions/20260903-portal): sign-out under a client preview
// session must exit the preview and restore the previewer's own session
// -- never revoke the real client's own Supabase session server-side (the
// review's second finding: signOut() under preview used to call
// createClient(), which is the impersonated client, so
// supabase.auth.signOut() revoked the actual customer's session).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let isPreview: boolean;
let cookieSets: { name: string; value: string; options: unknown }[];
let realSignOutCalls: number;
let redirectedTo: string | null;

vi.mock("@/lib/supabase/server", () => ({
  isPortalPreview: async () => isPreview,
  createClient: async () => ({
    auth: {
      signOut: async () => {
        realSignOutCalls += 1;
        return { error: null };
      },
    },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) => {
      cookieSets.push({ name, value, options });
    },
    get: () => undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirectedTo = to;
    // Next's real redirect() throws to unwind the render; mirror that so
    // signOut()'s own control flow (it's typed Promise<never>) behaves
    // the same under test.
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

beforeEach(() => {
  vi.resetModules();
  isPreview = false;
  cookieSets = [];
  realSignOutCalls = 0;
  redirectedTo = null;
});

describe("signOut under preview (F024b)", () => {
  it("test_signout_under_preview_never_calls_the_impersonated_clients_signOut", async () => {
    isPreview = true;
    const { signOut } = await import("@/lib/actions/auth");
    await expect(signOut("acme")).rejects.toThrow("NEXT_REDIRECT:");
    // The defect this fixes: signOut() used to call createClient() (the
    // impersonated client under preview) and invoke .auth.signOut() on
    // it, which revokes the REAL client's own Supabase session
    // server-side. That call must never happen under preview.
    expect(realSignOutCalls).toBe(0);
  });

  it("test_signout_under_preview_clears_all_preview_cookies", async () => {
    isPreview = true;
    const { signOut } = await import("@/lib/actions/auth");
    await expect(signOut("acme")).rejects.toThrow();
    const names = cookieSets.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "portal_preview_access_token",
        "portal_preview_refresh_token",
        "portal_preview_client_label",
        "portal_preview_client_member_id",
      ]),
    );
    for (const set of cookieSets) {
      expect((set.options as { maxAge: number }).maxAge).toBe(0);
    }
  });

  it("test_signout_under_preview_redirects_back_to_the_previewers_own_admin_surface", async () => {
    isPreview = true;
    const { signOut } = await import("@/lib/actions/auth");
    await expect(signOut("acme")).rejects.toThrow();
    expect(redirectedTo).toBe("/w/acme/preview-as-client");
  });

  it("test_signout_without_preview_still_calls_the_real_signOut_and_goes_to_sign_in", async () => {
    isPreview = false;
    const { signOut } = await import("@/lib/actions/auth");
    await expect(signOut()).rejects.toThrow();
    expect(realSignOutCalls).toBe(1);
    expect(redirectedTo).toBe("/sign-in");
    // No preview cookie touched -- the non-preview path is unchanged.
    expect(cookieSets).toHaveLength(0);
  });
});
