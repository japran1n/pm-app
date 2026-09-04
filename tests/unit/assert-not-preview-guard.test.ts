// F024b: unit coverage for the shared `assertNotPreview()` seam itself
// (lib/auth/assert-not-preview.ts), including its deliberately narrow
// fallback for pre-existing test doubles that mock
// `@/lib/supabase/server` without an `isPortalPreview` export (see that
// function's own header comment for why this must not crash dozens of
// tests/integration/*.test.ts files that predate this feature).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

describe("assertNotPreview()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_AS_052_refuses_when_isPortalPreview_resolves_true", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      isPortalPreview: async () => true,
      PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE:
        "You're previewing as a client. Actions are disabled in preview.",
    }));
    const { assertNotPreview } = await import("@/lib/auth/assert-not-preview");
    const result = await assertNotPreview();
    expect(result).toEqual({
      ok: false,
      error: "You're previewing as a client. Actions are disabled in preview.",
    });
  });

  it("test_AS_052_allows_when_isPortalPreview_resolves_false", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      isPortalPreview: async () => false,
      PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE: "blocked",
    }));
    const { assertNotPreview } = await import("@/lib/auth/assert-not-preview");
    expect(await assertNotPreview()).toEqual({ ok: true });
  });

  it("test_AS_052_does_not_crash_when_a_test_double_omits_isPortalPreview_entirely", async () => {
    // Mirrors the real shape of e.g. tests/integration/add-comment.test.ts's
    // pre-existing mock, which only ever provided `createClient`.
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({}),
    }));
    const { assertNotPreview } = await import("@/lib/auth/assert-not-preview");
    await expect(assertNotPreview()).resolves.toEqual({ ok: true });
  });
});
