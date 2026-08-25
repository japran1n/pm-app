import { describe, expect, it, vi, beforeEach } from "vitest";

// F263 (AS-510): lib/actions/favorites.ts's own unit coverage --
// unauthenticated rejection, invalid input rejection, and (critically,
// since project_favorites' RLS is own-row only, not project-scoped -- see
// that migration's header comment) that a project the caller cannot see
// is rejected by the ACTION's own visibility check, not left to RLS alone.
// Cross-user RLS itself is proven directly against the live DB in
// tests/integration/rls-project-favorites.test.ts, per this mission's
// "RLS must be tested via the direct PostgREST path" lesson -- this file
// only covers the action-layer logic that a mocked client can exercise
// deterministically.

function makeSupabaseMock(opts: {
  user: { id: string } | null;
  projectVisible: boolean;
  upsertError?: { message: string } | null;
  deleteError?: { message: string } | null;
}) {
  const projectsChain = {
    select: () => projectsChain,
    eq: () => projectsChain,
    is: () => projectsChain,
    maybeSingle: async () => ({
      data: opts.projectVisible ? { id: "project-1" } : null,
      error: null,
    }),
  };

  const favoritesEqChain: { eq: () => Promise<{ error: unknown }> } = {
    eq: () => favoritesEqChain as unknown as Promise<{ error: unknown }>,
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: (table: string) => {
      if (table === "projects") return projectsChain;
      if (table === "project_favorites") {
        return {
          upsert: async () => ({ error: opts.upsertError ?? null }),
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: opts.deleteError ?? null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

describe("favoriteProject / unfavoriteProject actions (F263, AS-510)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_AS_510_favoriteProject_rejects_an_unauthenticated_caller", async () => {
    mockSupabase = makeSupabaseMock({ user: null, projectVisible: true });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const result = await favoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
  });

  it("test_AS_510_favoriteProject_rejects_an_invalid_project_id", async () => {
    mockSupabase = makeSupabaseMock({ user: { id: "u1" }, projectVisible: true });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const result = await favoriteProject("not-a-uuid");
    expect(result.ok).toBe(false);
  });

  it("test_AS_510_favoriteProject_rejects_a_project_the_caller_cannot_see_even_though_project_favorites_rls_is_own_row_only", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "u1" },
      projectVisible: false,
    });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const result = await favoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("test_AS_510_favoriteProject_succeeds_for_a_visible_project", async () => {
    mockSupabase = makeSupabaseMock({ user: { id: "u1" }, projectVisible: true });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const result = await favoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isFavorite).toBe(true);
    }
  });

  it("test_AS_510_unfavoriteProject_succeeds_and_is_idempotent_no_error_when_nothing_to_delete", async () => {
    mockSupabase = makeSupabaseMock({ user: { id: "u1" }, projectVisible: true });
    const { unfavoriteProject } = await import("@/lib/actions/favorites");

    const result = await unfavoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isFavorite).toBe(false);
    }
  });

  it("test_AS_510_unfavoriteProject_rejects_an_unauthenticated_caller", async () => {
    mockSupabase = makeSupabaseMock({ user: null, projectVisible: true });
    const { unfavoriteProject } = await import("@/lib/actions/favorites");

    const result = await unfavoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
  });
});
