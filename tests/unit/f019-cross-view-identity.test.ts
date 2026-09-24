// Mission 20260910-182104, F019 (AS-004, AS-005): cross-view identity.
// Pages ARE tasks (page_slug set, parent_task_id null); sections ARE
// subtasks (parent_task_id = the page task's id). Because both live in
// the same `tasks` table, a page created on the board is necessarily one
// of the rows the project's task list view reads, and a section created
// on the board is necessarily one of the rows a task detail view's
// subtask list reads -- there is no separate "board" table to fall out of
// sync. This test proves that identity at the data-shape level: createPage
// produces a row with `page_slug` set, createSection produces a row with
// `parent_task_id` set to the page's task id.
//
// Mocks follow tests/unit/f010-create-page-action.test.ts's own
// createAdminClient stub pattern.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

let insertedRow: Record<string, unknown> | null = null;
let rpcCalls: { name: string; args: unknown }[] = [];
let existingCount = 0;

function resetShared() {
  insertedRow = null;
  rpcCalls = [];
  existingCount = 0;
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
          select: (columns: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count) {
              const builder = {
                eq: () => builder,
                is: () => builder,
                not: async () => ({ count: existingCount, error: null }),
              };
              return builder;
            }

            // createPage's slug-uniqueness check (`select("id")`) -- no
            // existing page shares the slug in this test.
            if (columns === "id") {
              const builder = {
                eq: () => builder,
                is: () => builder,
                maybeSingle: async () => ({ data: null, error: null }),
              };
              return builder;
            }

            // createSection's "confirm the parent is a page" lookup and
            // createPage's insert-result chain both go through here.
            const builder = {
              eq: () => builder,
              is: () => builder,
              maybeSingle: async () => ({
                data: {
                  id: "66666666-6666-4666-8666-666666666666",
                  project_id: "33333333-3333-4333-8333-333333333333",
                  page_slug: "home",
                  parent_task_id: null,
                },
                error: null,
              }),
              single: async () => ({ data: insertedRow, error: null }),
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

describe("F019 cross-view identity (AS-004, AS-005)", () => {
  it("test_AS_004_created_page_is_a_task_row_with_page_slug_set_so_it_appears_in_the_task_list_view", async () => {
    const { createPage } = await import("@/lib/actions/architecture");

    const result = await createPage("33333333-3333-4333-8333-333333333333", {
      name: "Home",
      slug: "home",
      page_kind: "static",
    });

    expect(result.ok).toBe(true);
    // A page is a row in the same `tasks` table the project's list view
    // queries, distinguished only by `page_slug` -- no separate storage
    // to keep in sync, so it necessarily shows up there.
    expect(insertedRow?.page_slug).toBe("home");
    expect(insertedRow?.parent_task_id).toBeNull();
  });

  it("test_AS_005_created_section_is_a_subtask_row_with_parent_task_id_set_so_it_appears_in_the_task_detail_view", async () => {
    const { createSection } = await import("@/lib/actions/architecture");

    const result = await createSection(
      "66666666-6666-4666-8666-666666666666",
      "33333333-3333-4333-8333-333333333333",
      "Hero",
    );

    expect(result.success).toBe(true);
    // A section is a subtask row parented to the page's task id -- the
    // exact shape a task detail view's subtask list reads, so it shows
    // up there with no separate sync step.
    expect(insertedRow?.parent_task_id).toBe("66666666-6666-4666-8666-666666666666");
    expect(insertedRow?.page_slug).toBeUndefined();
  });
});
