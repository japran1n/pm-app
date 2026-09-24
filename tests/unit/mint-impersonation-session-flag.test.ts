// mintImpersonationSession must refuse on its own when
// PORTAL_PREVIEW_MINT_ENABLED is off, independent of its caller's check.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let adminCalls = 0;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminCalls += 1;
    return {
      auth: {
        admin: {
          generateLink: async () => ({ data: null, error: { message: "x" } }),
        },
      },
    };
  },
}));

describe("mintImpersonationSession flag gate", () => {
  beforeEach(() => {
    vi.resetModules();
    adminCalls = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null without touching the admin client when the flag is off", async () => {
    vi.stubEnv("PORTAL_PREVIEW_MINT_ENABLED", undefined);
    const { mintImpersonationSession } = await import(
      "@/lib/auth/mint-impersonation-session"
    );
    expect(await mintImpersonationSession("client@example.com")).toBeNull();
    expect(adminCalls).toBe(0);
  });

  it("reaches the admin client only when the flag is exactly \"true\"", async () => {
    vi.stubEnv("PORTAL_PREVIEW_MINT_ENABLED", "true");
    const { mintImpersonationSession } = await import(
      "@/lib/auth/mint-impersonation-session"
    );
    expect(await mintImpersonationSession("client@example.com")).toBeNull();
    expect(adminCalls).toBe(1);
  });
});
