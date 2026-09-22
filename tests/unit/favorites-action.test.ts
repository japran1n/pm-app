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
  // SB-040: simulates real Postgres/RLS behaviour -- a plain upsert (no
  // ignoreDuplicates) resolves to `ON CONFLICT DO UPDATE`, which is denied
  // by RLS on a table with no UPDATE policy on the *second* call for the
  // same (user_id, project_id) row. Only relevant when `upsertError` is not
  // already forced.
  simulateRlsOnConflictDoUpdate?: boolean;
  upsertCalls?: Array<{ row: unknown; options: unknown }>;
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

  const favoritedRows = new Set<string>();

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: (table: string) => {
      if (table === "projects") return projectsChain;
      if (table === "project_favorites") {
        return {
          upsert: async (row: { user_id: string; project_id: string }, options: {
            onConflict?: string;
            ignoreDuplicates?: boolean;
          }) => {
            opts.upsertCalls?.push({ row, options });

            if (opts.upsertError) {
              return { error: opts.upsertError };
            }

            const key = `${row.user_id}:${row.project_id}`;
            const isConflict = favoritedRows.has(key);

            if (
              opts.simulateRlsOnConflictDoUpdate &&
              isConflict &&
              !options?.ignoreDuplicates
            ) {
              // Mirrors real RLS: DO UPDATE branch has no policy to allow it.
              return {
                error: { message: "new row violates row-level security policy" },
              };
            }

            favoritedRows.add(key);
            return { error: null };
          },
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

  // SB-040: favoriteProject must be safely re-callable for an
  // already-favourited project. project_favorites has no UPDATE policy, so
  // this only holds if the write resolves to `ON CONFLICT DO NOTHING`
  // (ignoreDuplicates: true), not `DO UPDATE`. The mock's
  // `simulateRlsOnConflictDoUpdate` reproduces the real RLS denial a plain
  // upsert would hit on the second call, so this test fails if the
  // `ignoreDuplicates` fix is removed.
  it("test_SB_040_favoriteProject_can_be_called_twice_for_the_same_project_and_both_calls_succeed", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "u1" },
      projectVisible: true,
      simulateRlsOnConflictDoUpdate: true,
    });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const first = await favoriteProject("11111111-1111-4111-8111-111111111111");
    const second = await favoriteProject("11111111-1111-4111-8111-111111111111");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  // SB-040: pins down the exact upsert options used, so a regression back
  // to a plain onConflict-only upsert (no ignoreDuplicates) is caught even
  // if the mock's RLS simulation were ever loosened.
  it("test_SB_040_favoriteProject_upserts_with_onConflict_and_ignoreDuplicates", async () => {
    const upsertCalls: Array<{ row: unknown; options: unknown }> = [];
    mockSupabase = makeSupabaseMock({
      user: { id: "u1" },
      projectVisible: true,
      upsertCalls,
    });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    await favoriteProject("11111111-1111-4111-8111-111111111111");

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].options).toMatchObject({
      onConflict: "user_id,project_id",
      ignoreDuplicates: true,
    });
  });

  // D3: the upsertError/deleteError mock options were declared but never
  // exercised, leaving the ok:false write-failure branches untested.
  it("test_AS_510_favoriteProject_returns_ok_false_when_the_upsert_fails", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "u1" },
      projectVisible: true,
      upsertError: { message: "boom" },
    });
    const { favoriteProject } = await import("@/lib/actions/favorites");

    const result = await favoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not favourite/i);
    }
  });

  it("test_AS_510_unfavoriteProject_returns_ok_false_when_the_delete_fails", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "u1" },
      projectVisible: true,
      deleteError: { message: "boom" },
    });
    const { unfavoriteProject } = await import("@/lib/actions/favorites");

    const result = await unfavoriteProject("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not remove/i);
    }
  });
});
