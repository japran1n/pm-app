// Mission 20260910-182104, F030 (AS-060, AS-061): deleteComponent
// (lib/actions/architecture.ts).
//
// AS-060: deleting a component leaves its instance sections in place.
// AS-061: deleting a component clears the component link on all its
// instances.
//
// The `tasks.component_id` FK is `ON DELETE SET NULL`
// (supabase/migrations/20261121010000_f002_page_components.sql), so this
// unit test verifies the action issues the delete against
// `page_components` and, via the same in-memory stub simulating that FK
// behaviour, that the instance rows survive with their link cleared --
// mirroring what the real database constraint enforces.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_ID = "66666666-6666-4666-8666-666666666666";
const SECTION_A_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_B_ID = "55555555-5555-4555-8555-555555555555";

type TaskRow = { id: string; title: string; component_id: string | null };

let component: { id: string; project_id: string } | null;
let tasks: Record<string, TaskRow>;
let deleteCalled = false;

function resetShared() {
  component = { id: COMPONENT_ID, project_id: PROJECT_ID };
  tasks = {
    [SECTION_A_ID]: { id: SECTION_A_ID, title: "Hero", component_id: COMPONENT_ID },
    [SECTION_B_ID]: { id: SECTION_B_ID, title: "Hero copy", component_id: COMPONENT_ID },
  };
  deleteCalled = false;
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

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "admin" }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => true,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "page_components") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (!component || component.id !== id) {
                  return { data: null, error: null };
                }
                return {
                  data: {
                    ...component,
                    projects: { workspace_id: WORKSPACE_ID },
                  },
                  error: null,
                };
              },
            }),
          }),
          delete: () => ({
            eq: async (_col: string, id: string) => {
              deleteCalled = true;
              if (component && component.id === id) {
                component = null;
                // Simulate the DB's `on delete set null` FK behaviour:
                // instance rows survive, their link is cleared.
                for (const key of Object.keys(tasks)) {
                  if (tasks[key].component_id === id) {
                    tasks[key] = { ...tasks[key], component_id: null };
                  }
                }
              }
              return { error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
  }),
}));

describe("F030 deleteComponent", () => {
  beforeEach(() => {
    resetShared();
  });

  it("issues a delete against page_components", async () => {
    const { deleteComponent } = await import("@/lib/actions/architecture");

    const result = await deleteComponent(COMPONENT_ID);

    expect(result.success).toBe(true);
    expect(deleteCalled).toBe(true);
    expect(component).toBeNull();
  });

  it("AS-060: instance sections remain in place after the component is deleted", async () => {
    const { deleteComponent } = await import("@/lib/actions/architecture");

    await deleteComponent(COMPONENT_ID);

    expect(tasks[SECTION_A_ID]).toBeDefined();
    expect(tasks[SECTION_A_ID].title).toBe("Hero");
    expect(tasks[SECTION_B_ID]).toBeDefined();
    expect(tasks[SECTION_B_ID].title).toBe("Hero copy");
  });

  it("AS-061: the component link is cleared on all instances after deletion", async () => {
    const { deleteComponent } = await import("@/lib/actions/architecture");

    await deleteComponent(COMPONENT_ID);

    expect(tasks[SECTION_A_ID].component_id).toBeNull();
    expect(tasks[SECTION_B_ID].component_id).toBeNull();
  });

  it("returns an error when the component does not exist", async () => {
    const { deleteComponent } = await import("@/lib/actions/architecture");

    const result = await deleteComponent("does-not-exist");

    expect(result.success).toBe(false);
  });
});
