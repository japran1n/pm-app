// Mission 20260910-182104, F010 (AS-001, AS-002, AS-031, AS-037):
// createPage (lib/actions/architecture.ts). Standing decision 1: a page
// IS a task with `page_slug` set and the workspace's `page` task type.
//
// Mocks `@/lib/supabase/admin`'s createAdminClient the same way
// tests/unit/f024b-preview-write-guard.test.ts does for other action
// tests -- a minimal chainable stub recording the insert row and the
// `ensure_task_type` rpc call.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

let insertedRow: Record<string, unknown> | null = null;
let rpcCalls: { name: string; args: unknown }[] = [];
let existingPageCount = 0;
// F012 (AS-017): set to a truthy row to simulate an existing page with the
// same slug already in this project.
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
              // count(head) query used to compute AS-037's page position.
              const builder = {
                eq: () => builder,
                is: () => builder,
                not: async () => ({ count: existingPageCount, error: null }),
              };
              return builder;
            }
            // F012 (AS-017): select("id").eq().eq().is().maybeSingle()
            // slug-uniqueness lookup.
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

describe("createPage (F010)", () => {
  it("test_AS_001_created_page_is_a_task_with_a_page_slug_set", async () => {
    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "Home",
      slug: "home",
      page_kind: "static",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pageSlug).toBe("home");
    }
    expect(insertedRow?.page_slug).toBe("home");
  });

  it("test_AS_002_created_page_carries_the_workspace_page_task_type", async () => {
    const { createPage } = await import("@/lib/actions/architecture");
    await createPage("33333333-3333-4333-8333-333333333333", {
      name: "Home",
      slug: "home",
      page_kind: "static",
    });

    const ensureCall = rpcCalls.find((call) => call.name === "ensure_task_type");
    expect(ensureCall).toBeDefined();
    expect((ensureCall?.args as { p_system_key: string }).p_system_key).toBe(
      "page",
    );
    expect(insertedRow?.task_type_id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("test_AS_031_new_page_defaults_to_page_kind_static", async () => {
    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "Home",
      slug: "home",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pageKind).toBe("static");
    }
  });

  it("test_AS_037_new_page_is_placed_at_the_end_of_the_column_order", async () => {
    existingPageCount = 3;

    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "About",
      slug: "about",
      page_kind: "static",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.position).toBe(4);
    }
  });

  it("test_AS_039_page_name_cannot_be_empty", async () => {
    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "   ",
      slug: "home",
      page_kind: "static",
    });

    expect(result.ok).toBe(false);
    expect(insertedRow).toBeNull();
  });
});
