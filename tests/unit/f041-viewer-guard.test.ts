// Mission 20260910-182104, F041 (AS-097): a viewer-role team member
// cannot modify the architecture board. This is the same server-side
// `canWrite` re-check F040 verifies for pages/components, exercised here
// specifically for the viewer role against createPage, deletePage, and
// createSection -- the three mutation entry points named in this
// feature's spec.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PAGE_TASK_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
  }),
}));

// Real membership role: "viewer" -- not stubbed to always allow. Pairs
// with the real (unmocked) canWrite predicate to prove a viewer is
// actually rejected, not merely assumed to be.
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "viewer" }),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

let insertCalled = false;
let _updateCalled = false;
let rpcCalled = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: PROJECT_ID,
                    workspace_id: WORKSPACE_ID,
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
        const pageRow = {
          id: PAGE_TASK_ID,
          project_id: PROJECT_ID,
          page_slug: "home",
          parent_task_id: null,
          projects: { workspace_id: WORKSPACE_ID },
        };
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: pageRow, error: null }),
                }),
              }),
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: PAGE_TASK_ID,
                    project_id: PROJECT_ID,
                    page_slug: "home",
                    parent_task_id: null,
                    projects: { workspace_id: WORKSPACE_ID },
                  },
                  error: null,
                }),
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: null,
                  }),
                }),
              }),
              maybeSingle: async () => ({
                data: {
                  id: PAGE_TASK_ID,
                  project_id: PROJECT_ID,
                  page_slug: "home",
                  parent_task_id: null,
                  projects: { workspace_id: WORKSPACE_ID },
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => {
              _updateCalled = true;
              return { error: null };
            },
          }),
          insert: () => {
            insertCalled = true;
            return {
              select: () => ({
                single: async () => ({ data: { id: "new-id" }, error: null }),
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
    rpc: async () => {
      rpcCalled = true;
      return { data: true, error: null };
    },
  }),
}));

describe("F041 viewer-role guard (AS-097)", () => {
  beforeEach(() => {
    insertCalled = false;
    _updateCalled = false;
    rpcCalled = false;
    vi.resetModules();
  });

  it("AS-097: a viewer cannot create a page", async () => {
    const { createPage } = await import("@/lib/actions/architecture");
    const result = await createPage(PROJECT_ID, {
      name: "New page",
      slug: "new-page",
      page_kind: "static",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }
    expect(insertCalled).toBe(false);
  });

  it("AS-097: a viewer cannot delete a page", async () => {
    const { deletePage } = await import("@/lib/actions/architecture");
    const result = await deletePage(PAGE_TASK_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(rpcCalled).toBe(false);
  });

  it("AS-097: a viewer cannot create a section", async () => {
    const { createSection } = await import("@/lib/actions/architecture");
    const result = await createSection(PAGE_TASK_ID, PROJECT_ID, "New section");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(insertCalled).toBe(false);
  });
});
