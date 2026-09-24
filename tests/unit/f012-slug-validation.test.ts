// Mission 20260910-182104, F012 (AS-017, AS-018):
//
//   AS-017: two pages in the same project cannot have the same slug.
//   AS-018: a page cannot be saved with an empty slug.
//
// Reuses the same createAdminClient stub shape as
// tests/unit/f010-create-page-action.test.ts for the action-level
// uniqueness check, plus direct schema tests for the empty-slug case.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { createPageSchema } from "@/lib/validation/architecture";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

describe("createPageSchema.slug (F012, AS-018)", () => {
  it("test_AS_018_empty_slug_fails_validation", () => {
    const result = createPageSchema.safeParse({
      name: "Home",
      slug: "",
      page_kind: "static",
    });
    expect(result.success).toBe(false);
  });

  it("test_AS_018_whitespace_only_slug_fails_validation", () => {
    const result = createPageSchema.safeParse({
      name: "Home",
      slug: "   ",
      page_kind: "static",
    });
    expect(result.success).toBe(false);
  });

  it("a valid slug passes validation", () => {
    const result = createPageSchema.safeParse({
      name: "Home",
      slug: "services/seo",
      page_kind: "static",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a slug with a leading slash", () => {
    const result = createPageSchema.safeParse({
      name: "Home",
      slug: "/services",
      page_kind: "static",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a slug with a trailing slash", () => {
    const result = createPageSchema.safeParse({
      name: "Home",
      slug: "services/",
      page_kind: "static",
    });
    expect(result.success).toBe(false);
  });
});

let insertedRow: Record<string, unknown> | null = null;
let rpcCalls: { name: string; args: unknown }[] = [];
let existingPageCount = 0;
let existingSlugRow: { id: string } | null = null;

function resetShared() {
  insertedRow = null;
  rpcCalls = [];
  existingPageCount = 0;
  existingSlugRow = null;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "ensure_task_type") {
        return { data: "22222222-2222-4222-8222-222222222222", error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "33333333-3333-4333-8333-333333333333",
                    workspace_id: "44444444-4444-4444-8444-444444444444",
                    deleted_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "tasks") {
        return {
          select: (_columns: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count) {
              const builder = {
                eq: () => builder,
                is: () => builder,
                not: async () => ({ count: existingPageCount, error: null }),
              };
              return builder;
            }
            const builder = {
              eq: () => builder,
              is: () => builder,
              maybeSingle: async () => ({ data: existingSlugRow, error: null }),
            };
            return builder;
          },
          insert: (row: Record<string, unknown>) => {
            insertedRow = {
              id: "55555555-5555-4555-8555-555555555555",
              ...row,
            };
            return {
              select: () => ({
                single: async () => ({ data: insertedRow, error: null }),
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
  }),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "member" }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  vi.resetModules();
  resetShared();
});

describe("createPage slug uniqueness (F012, AS-017)", () => {
  it("test_AS_017_rejects_a_duplicate_slug_in_the_same_project", async () => {
    existingSlugRow = { id: "99999999-9999-4999-8999-999999999999" };

    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "Home",
      slug: "home",
      page_kind: "static",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already exists/i);
    }
    expect(insertedRow).toBeNull();
  });

  it("test_AS_017_allows_a_unique_slug_in_the_same_project", async () => {
    existingSlugRow = null;

    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "About",
      slug: "about",
      page_kind: "static",
    });

    expect(result.ok).toBe(true);
    expect(insertedRow?.page_slug).toBe("about");
  });
});
